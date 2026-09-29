/* The WebGL renderer: owns the snapshot texture, the lens list and the
 * per-frame draw. Capture is injected via captureToCanvas. */
import { debounce, effectiveZ, compileShader, createProgram } from "./util.js";
import { TEST_ENABLED, testOpt, testEngineVersion } from "./test-hooks.js";
import { captureToCanvas } from "./capture/index.js";
import { resolveEngine, GlassworksEngineError, noEngineMessage } from "./capture/engines.js";
import { liquidGLLens } from "./lens.js";

/* --------------------------------------------------
 *  Shared renderer (one per page)
 * ------------------------------------------------*/
export class liquidGLRenderer {
  constructor(
    snapshotSelector,
    snapshotResolution = 1.0,
    engine = "snapdom",
    allowFallback = true
  ) {
    this._allowFallback = allowFallback !== false;
    /* An adapter object is kept as-is; a name is normalised. */
    this._engine =
      engine && typeof engine === "object" && typeof engine.capture === "function"
        ? engine
        : engine === "html2canvas"
        ? "html2canvas"
        : "snapdom";
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;`;
    this.canvas.setAttribute("data-liquid-ignore", "");
    document.body.appendChild(this.canvas);

    const ctxAttribs = {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    };
    this.gl =
      this.canvas.getContext("webgl2", ctxAttribs) ||
      this.canvas.getContext("webgl", ctxAttribs) ||
      this.canvas.getContext("experimental-webgl", ctxAttribs);
    if (!this.gl) throw new Error("liquidGL: WebGL unavailable");

    this.lenses = [];
    this.texture = null;
    this.textureWidth = 0;
    this.textureHeight = 0;
    this.scaleFactor = 1;
    this.startTime = Date.now();
    this._scrollUpdateCounter = 0;

    this._initGL();

    this.snapshotTarget =
      document.querySelector(snapshotSelector) || document.body;
    if (!this.snapshotTarget) this.snapshotTarget = document.body;

    this._isScrolling = false;
    let lastScrollY = window.scrollY;
    let scrollTimeout;
    const scrollCheck = () => {
      if (window.scrollY !== lastScrollY) {
        this._isScrolling = true;
        lastScrollY = window.scrollY;
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          this._isScrolling = false;
        }, 200);
      }
      requestAnimationFrame(scrollCheck);
    };
    requestAnimationFrame(scrollCheck);

    const onResize = debounce(() => {
      if (this._capturing || this._isScrolling) return;

      if (window.visualViewport && window.visualViewport.scale !== 1) {
        return;
      }

      this._dynamicNodes.forEach((node) => {
        const meta = this._dynMeta.get(node.el);
        if (meta) {
          meta.needsRecapture = true;
          meta.prevDrawRect = null;
          meta.lastCapture = null;
        }
      });

      this._resizeCanvas();
      this.lenses.forEach((l) => l.updateMetrics());
      this.captureSnapshot();
    }, 250);
    window.addEventListener("resize", onResize, { passive: true });

    if ("ResizeObserver" in window) {
      new ResizeObserver(onResize).observe(this.snapshotTarget);
    }

    /* --------------------------------------------------
     *  Dynamic DOM elements (non-video, e.g. animating text)
     * ------------------------------------------------*/
    this._dynamicNodes = [];
    this._dynMeta = new WeakMap();
    this._lastDynamicUpdate = 0;

    const styleEl = document.createElement("style");
    styleEl.id = "liquid-gl-dynamic-styles";
    document.head.appendChild(styleEl);
    this._dynamicStyleSheet = styleEl.sheet;

    this._snapshotResolution = Math.max(
      0.1,
      Math.min(3.0, snapshotResolution)
    );

    this._resizeCanvas();
    /* Defer the first capture by one microtask. This lets the user
       finish registering dynamic elements (registerDynamic batches
       on the same tick) before snapdom runs, so we capture *once*
       with the full ignore set instead of capturing twice — once
       with all dynamic content visible, then again with it hidden.
       On Safari, where snapdom is slow, that double-capture is the
       most likely cause of the "text disappears for a beat after
       load" behaviour. */
    this._captureRequested = true;
    Promise.resolve().then(() => {
      this._captureRequested = false;
      this.captureSnapshot();
    });

    this._pendingReveal = [];

    /* --------------------------------------------------
     *  Dynamic media (video) support
     * ------------------------------------------------*/
    this._videoNodes = Array.from(
      this.snapshotTarget.querySelectorAll("video")
    );
    this._videoNodes = this._videoNodes.filter((v) => !this._isIgnored(v));
    this._tmpCanvas = document.createElement("canvas");
    this._tmpCtx = this._tmpCanvas.getContext("2d");

    this.canvas.style.opacity = "0";

    this.useExternalTicker = false;

    /* --------------------------------------------------
     *  Inline worker for heavy dynamic nodes
     * ------------------------------------------------*/
    this._workerEnabled =
      typeof OffscreenCanvas !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof ImageBitmap !== "undefined";

    if (this._workerEnabled) {
      const workerSrc = `
        /* dynamic-element worker (runs in its own thread) */
        self.onmessage = async (e) => {
          const { id, width, height, snap, dyn } = e.data;
          const off = new OffscreenCanvas(width, height);
          const ctx = off.getContext('2d');

          ctx.drawImage(snap, 0, 0, width, height);
          ctx.drawImage(dyn, 0, 0, width, height);

          const bmp = await off.transferToImageBitmap();
          self.postMessage({ id, bmp }, [bmp]);
        };
      `;
      const blob = new Blob([workerSrc], { type: "application/javascript" });
      this._dynWorker = new Worker(URL.createObjectURL(blob), {
        type: "module",
      });

      this._dynJobs = new Map();

      this._dynWorker.onmessage = (e) => {
        const { id, bmp } = e.data;
        const meta = this._dynJobs.get(id);
        if (!meta) return;
        this._dynJobs.delete(id);

        const { x, y, w, h } = meta;
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          x,
          y,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bmp
        );
      };
    }
  }

  /* ----------------------------- */
  _initGL() {
    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main(){
        v_uv = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }`;

    const fsSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec2  u_resolution;
      uniform vec2  u_textureResolution;
      uniform vec4  u_bounds;
      uniform float u_refraction;
      uniform float u_bevelDepth;
      uniform float u_bevelWidth;
      uniform float u_frost;
      uniform float u_radius;
      uniform float u_time;
      uniform bool  u_specular;
      uniform float u_revealProgress;
      uniform int   u_revealType;
      uniform float u_tiltX;
      uniform float u_tiltY;
      uniform float u_magnify;

      float udRoundBox( vec2 p, vec2 b, float r ) {
        return length(max(abs(p)-b+r,0.0))-r;
      }

      float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
      }

      float edgeFactor(vec2 uv, float radius_px){
        vec2 p_px = (uv - 0.5) * u_resolution;
        vec2 b_px = 0.5 * u_resolution;
        float d = -udRoundBox(p_px, b_px, radius_px);
        float bevel_px = u_bevelWidth * min(u_resolution.x, u_resolution.y);
        return 1.0 - smoothstep(0.0, bevel_px, d);
      }
      void main(){
        vec2 p = v_uv - 0.5;
        p.x *= u_resolution.x / u_resolution.y;

        float edge = edgeFactor(v_uv, u_radius);
        float min_dimension = min(u_resolution.x, u_resolution.y);
        float offsetAmt = (edge * u_refraction + pow(edge, 10.0) * u_bevelDepth);
        float centreBlend = smoothstep(0.15, 0.45, length(p));
        vec2 offset = normalize(p) * offsetAmt * centreBlend;

        float tiltRefractionScale = 0.05;
        vec2 tiltOffset = vec2(tan(radians(u_tiltY)), -tan(radians(u_tiltX))) * tiltRefractionScale;

        vec2 localUV = (v_uv - 0.5) / u_magnify + 0.5;
        vec2 flippedUV = vec2(localUV.x, 1.0 - localUV.y);
        vec2 mapped = u_bounds.xy + flippedUV * u_bounds.zw;
        vec2 refracted = mapped + offset - tiltOffset;

        float oob = max(max(-refracted.x, refracted.x - 1.0), max(-refracted.y, refracted.y - 1.0));
        float blend = 1.0 - smoothstep(0.0, 0.01, oob);
        vec2 sampleUV = mix(mapped, refracted, blend);

        vec4 baseCol   = texture2D(u_tex, mapped);

        vec2 texel = 1.0 / u_textureResolution;
        vec4 refrCol;

        if (u_frost > 0.0) {
            float radius = u_frost * 4.0;
            vec4 sum = vec4(0.0);
            const int SAMPLES = 16;

            for (int i = 0; i < SAMPLES; i++) {
                float angle = random(v_uv + float(i)) * 6.283185;
                float dist = sqrt(random(v_uv - float(i))) * radius;
                vec2 offset = vec2(cos(angle), sin(angle)) * texel * dist;
                sum += texture2D(u_tex, sampleUV + offset);
            }
            refrCol = sum / float(SAMPLES);
        } else {
            /* No frost: sample once. Averaging the four neighbours softened
               every lens against its source. */
            refrCol = texture2D(u_tex, sampleUV);
        }

        if (refrCol.a < 0.1) {
            refrCol = baseCol;
        }

        float diff = clamp(length(refrCol.rgb - baseCol.rgb) * 4.0, 0.0, 1.0);

        float antiHalo = (1.0 - centreBlend) * diff;

        vec4 final    = refrCol;

        vec2 p_px = (v_uv - 0.5) * u_resolution;
        vec2 b_px = 0.5 * u_resolution;
        float dmask = udRoundBox(p_px, b_px, u_radius);
        float inShape = 1.0 - step(0.0, dmask);

        if (u_specular) {
          vec2 lp1 = vec2(sin(u_time*0.2), cos(u_time*0.3))*0.6 + 0.5;
          vec2 lp2 = vec2(sin(u_time*-0.4+1.5), cos(u_time*0.25-0.5))*0.6 + 0.5;
          float h = 0.0;
          h += smoothstep(0.4,0.0,distance(v_uv, lp1))*0.1;
          h += smoothstep(0.5,0.0,distance(v_uv, lp2))*0.08;
          final.rgb += h;
        }

        if (u_revealType == 1) {
            final.rgb *= u_revealProgress;
            final.a  *= u_revealProgress;
        }

        final.rgb *= inShape;
        final.a   *= inShape;

        gl_FragColor = final;
      }`;

    this.program = createProgram(this.gl, vsSource, fsSource);
    const gl = this.gl;
    if (!this.program) throw new Error("liquidGL: Shader failed");

    /* --------------------------------------------------
     *  Video-blit pipeline (GPU-side video → texture-region scale).
     *  -----------------------------------------------------------
     *  The original per-frame video update path was:
     *    drawImage(staticBg) → drawImage(video) → texSubImage2D(canvas)
     *  Each frame triggers a GPU→CPU pull of the decoded video
     *  frame (drawImage from a hardware-decoded video) and a
     *  CPU→GPU upload of the resulting canvas. On Chrome that
     *  pipeline is fast because Skia + ANGLE optimise it; on
     *  Safari and Firefox it's the dominant frame cost on the
     *  hero — it dwarfs the lens shader itself.
     *
     *  This pipeline keeps everything on the GPU. We:
     *    1. texImage2D the video element into a scratch texture
     *       (browser does GPU→GPU copy from the decoded surface).
     *    2. Bind a framebuffer with the *main* texture as colour
     *       attachment, viewport set to the destination region.
     *    3. Draw a textured quad sampling the scratch — that's
     *       the scaling pass; the GPU rasteriser handles it for
     *       free.
     *  No CPU round-trip, no drawImage, no canvas backing store.
     *
     *  Used only for videos *without* border-radius (the common
     *  case). Rounded videos still go through the canvas path
     *  because we need 2D `clip()` for the rounded mask.
     * ------------------------------------------------*/
    const vBlitVs = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main(){
        v_uv = (a_pos + 1.0) * 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }`;
    const vBlitFs = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_src;
      void main(){
        gl_FragColor = texture2D(u_src, v_uv);
      }`;
    this._vBlitProgram = createProgram(gl, vBlitVs, vBlitFs);
    if (this._vBlitProgram) {
      this._vBlitPosLoc = gl.getAttribLocation(this._vBlitProgram, "a_pos");
      this._vBlitTexLoc = gl.getUniformLocation(this._vBlitProgram, "u_src");
      this._vBlitQuadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vBlitQuadBuf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      this._vBlitFbo = gl.createFramebuffer();
      this._vScratchTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._vScratchTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    this._lensQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._lensQuadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    this._lensPosLoc = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(this._lensPosLoc);
    gl.vertexAttribPointer(this._lensPosLoc, 2, gl.FLOAT, false, 0, 0);

    this.u = {
      tex: gl.getUniformLocation(this.program, "u_tex"),
      res: gl.getUniformLocation(this.program, "u_resolution"),
      textureResolution: gl.getUniformLocation(
        this.program,
        "u_textureResolution"
      ),
      bounds: gl.getUniformLocation(this.program, "u_bounds"),
      refraction: gl.getUniformLocation(this.program, "u_refraction"),
      bevelDepth: gl.getUniformLocation(this.program, "u_bevelDepth"),
      bevelWidth: gl.getUniformLocation(this.program, "u_bevelWidth"),
      frost: gl.getUniformLocation(this.program, "u_frost"),
      radius: gl.getUniformLocation(this.program, "u_radius"),
      time: gl.getUniformLocation(this.program, "u_time"),
      specular: gl.getUniformLocation(this.program, "u_specular"),
      revealProgress: gl.getUniformLocation(this.program, "u_revealProgress"),
      revealType: gl.getUniformLocation(this.program, "u_revealType"),
      tiltX: gl.getUniformLocation(this.program, "u_tiltX"),
      tiltY: gl.getUniformLocation(this.program, "u_tiltY"),
      magnify: gl.getUniformLocation(this.program, "u_magnify"),
    };
  }

  /* ----------------------------- */
  _resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /* ----------------------------- */
  async captureSnapshot() {
    /* A missing engine used to return silently here, leaving every lens at
       opacity 0 with nothing logged. Surface it instead. */
    if (!this._engineChecked) {
      this._engineChecked = true;
      if (this._engine !== "html2canvas" && !resolveEngine(this._engine)) {
        this._engineError = new GlassworksEngineError(noEngineMessage(
          typeof this._engine === "string" ? this._engine : "snapdom"
        ));
      }
    }
    if (this._engineError) {
      console.error(this._engineError.message);
      /* Reveal the lenses so the elements do not just disappear. */
      this.lenses.forEach((l) => l._revealWithoutTexture && l._revealWithoutTexture());
      throw this._engineError;
    }
    /* If a capture is already in flight, queue a follow-up. The in-flight
       capture closed over a stale view of `_dynamicNodes` / `lenses`, so
       registerDynamic / addLens calls made after it started would otherwise
       leave their elements ghosted in the static snapshot. */
    if (this._capturing) {
      this._captureQueued = true;
      return;
    }
    this._capturing = true;

    const undos = [];

    const attemptCapture = async (
      attempt = 1,
      maxAttempts = 3,
      delayMs = 500
    ) => {
      const testInfo = TEST_ENABLED
        ? {
            attempt: attempt,
            engineRequested: this._engine,
            engine: null,
            fallbackRan: false,
            fallbackReason: null,
            fallbackSuppressed: false,
            timings: {},
          }
        : null;
      const tCap0 = testInfo ? performance.now() : 0;
      if (testInfo) window.__glassworks.capturing = true;
      try {
        const fullW = this.snapshotTarget.scrollWidth;
        const fullH = this.snapshotTarget.scrollHeight;
        const maxTex = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 8192;
        const MAX_MOBILE_DIM = 4096;
        const isMobileSafari = /iPad|iPhone|iPod/.test(navigator.userAgent);

        let scale = Math.min(
          this._snapshotResolution,
          maxTex / fullW,
          maxTex / fullH
        );

        if (isMobileSafari) {
          const over = (Math.max(fullW, fullH) * scale) / MAX_MOBILE_DIM;
          if (over > 1) scale = scale / over;
        }
        this.scaleFactor = Math.max(0.1, scale);

        this.canvas.style.visibility = "hidden";
        undos.push(() => (this.canvas.style.visibility = "visible"));

        const lensElements = this.lenses
          .flatMap((lens) => [lens.el, lens._shadowEl])
          .filter(Boolean);

        /* Registered dynamic elements (e.g. GSAP split lines) are drawn
           exclusively by the per-frame dynamic path. Including them in the
           static snapshot causes a ghost duplicate when a renderer
           (snapdom in particular) doesn't honour the host's overflow/mask
           clipping the same way html2canvas does. */
        const dynamicElements = (this._dynamicNodes || [])
          .map((n) => n && n.el)
          .filter(Boolean);

        const ignoreElementsFunc = (element) => {
          if (!element || !element.hasAttribute) return false;
          if (element === this.canvas || lensElements.includes(element)) {
            return true;
          }
          for (let i = 0; i < dynamicElements.length; i++) {
            const dyn = dynamicElements[i];
            if (element === dyn || (dyn.contains && dyn.contains(element))) {
              return true;
            }
          }
          const style = window.getComputedStyle(element);
          if (style.position === "fixed") {
            return true;
          }
          return (
            element.hasAttribute("data-liquid-ignore") ||
            element.closest("[data-liquid-ignore]")
          );
        };

        const tSnapCall = testInfo ? performance.now() : 0;
        /* snapdom normalises a transformed root only when asked, and that
           normalisation costs a 1px offset on every capture. The snapshot
           target is almost never transformed, so ask for it only when it is. */
        let snapEngineOptions;
        try {
          const cs = window.getComputedStyle(this.snapshotTarget);
          if (cs.transform && cs.transform !== "none") snapEngineOptions = { outerTransforms: false };
        } catch (_) {
          /* defensive: detached target */
        }

        const snapCanvas = await captureToCanvas(this.snapshotTarget, {
          scale: scale,
          ignore: ignoreElementsFunc,
          engine: this._engine,
          engineOptions: snapEngineOptions,
          allowFallback: this._allowFallback,
          validateCompleteness: true,
          onEngineFallback: (next) => {
            /* Cache the engine that worked so future captures skip
               the failed snapdom path entirely. */
            this._engine = next;
          },
          testInfo: testInfo,
        });
        if (testInfo) testInfo.timings.preMs = tSnapCall - tCap0;

        if (testInfo) {
          const gw = window.__glassworks;
          testInfo.timings.captureMs = performance.now() - tCap0;
          testInfo.engineVersion = testEngineVersion(testInfo.engine, resolveEngine(this._engine));
          testInfo.scale = scale;
          testInfo.targetWidth = fullW;
          testInfo.targetHeight = fullH;
          testInfo.width = snapCanvas ? snapCanvas.width : 0;
          testInfo.height = snapCanvas ? snapCanvas.height : 0;
          testInfo.maxTextureSize = maxTex;
          gw.captureCount++;
          gw.canvas = snapCanvas;
          gw.engine = testInfo.engine;
          gw.engineVersion = testInfo.engineVersion;
          gw.fallbackRan = testInfo.fallbackRan;
          gw.fallbackReason = testInfo.fallbackReason;
          gw.timings = testInfo.timings;
          gw.last = testInfo;
          gw.history.push(testInfo);
        }

        this._uploadTexture(snapCanvas);
        return true;
      } catch (e) {
        if (testInfo) {
          testInfo.error = String((e && e.message) || e);
          testInfo.timings.captureMs = performance.now() - tCap0;
          window.__glassworks.history.push(testInfo);
          if (attempt >= maxAttempts) window.__glassworks.failed = true;
        }
        console.error("liquidGL snapshot failed on attempt " + attempt, e);
        if (attempt < maxAttempts) {
          console.log(
            `Retrying snapshot capture (${attempt + 1}/${maxAttempts})...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return await attemptCapture(attempt + 1, maxAttempts, delayMs);
        } else {
          console.error("liquidGL: All snapshot attempts failed.", e);
          return false;
        }
      } finally {
        for (let i = undos.length - 1; i >= 0; i--) {
          undos[i]();
        }
        this._capturing = false;
        if (testInfo) window.__glassworks.capturing = false;
      }
    };

    const result = await attemptCapture();
    if (this._captureQueued) {
      this._captureQueued = false;
      this.captureSnapshot();
    }
    return result;
  }

  /* ----------------------------- */
  _uploadTexture(srcCanvas) {
    if (!srcCanvas) return;

    if (!(srcCanvas instanceof HTMLCanvasElement)) {
      const tmp = document.createElement("canvas");
      tmp.width = srcCanvas.width || 0;
      tmp.height = srcCanvas.height || 0;
      if (tmp.width === 0 || tmp.height === 0) return;
      try {
        const ctx = tmp.getContext("2d");
        ctx.drawImage(srcCanvas, 0, 0);
        srcCanvas = tmp;
      } catch (e) {
        console.warn(
          "liquidGL: Unable to convert OffscreenCanvas for upload",
          e
        );
        return;
      }
    }

    if (srcCanvas.width === 0 || srcCanvas.height === 0) return;

    /* snapdom occasionally returns a canvas a few pixels larger than
       our requested scale × source dimensions due to internal
       rounding. If it's even one pixel over MAX_TEXTURE_SIZE the
       WebGL allocation fails with INVALID_VALUE and *every* subsequent
       texSubImage2D errors with "Level of detail outside of range".
       Crop to fit before uploading. */
    const maxTex = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 8192;
    if (srcCanvas.width > maxTex || srcCanvas.height > maxTex) {
      const cw = Math.min(srcCanvas.width, maxTex);
      const ch = Math.min(srcCanvas.height, maxTex);
      const tmp = document.createElement("canvas");
      tmp.width = cw;
      tmp.height = ch;
      tmp.getContext("2d").drawImage(srcCanvas, 0, 0, cw, ch, 0, 0, cw, ch);
      srcCanvas = tmp;
    }

    this.staticSnapshotCanvas = srcCanvas;
    const gl = this.gl;
    if (!this.texture) this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      srcCanvas
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.textureWidth = srcCanvas.width;
    this.textureHeight = srcCanvas.height;

    /* The texture was just re-allocated (potentially at a new size),
       so any cached `prevDrawRect` from a previous dynamic-node frame
       now references stale texel coordinates. Clear them so the next
       render redraws cleanly without trying to "erase" pixels at
       offsets that may now be out of bounds. */
    if (this._dynMeta && this._dynamicNodes) {
      for (let i = 0; i < this._dynamicNodes.length; i++) {
        const meta = this._dynMeta.get(this._dynamicNodes[i].el);
        if (meta) meta.prevDrawRect = null;
      }
    }

    this.render();

    if (this._pendingReveal.length) {
      this._pendingReveal.forEach((ln) => ln._reveal());
      this._pendingReveal.length = 0;
    }
  }

  /* ----------------------------- */
  addLens(element, options) {
    const lens = new liquidGLLens(this, element, options);
    this.lenses.push(lens);

    const maxZ = this._getMaxLensZ();
    if (maxZ > 0) {
      this.canvas.style.zIndex = maxZ - 1;
    }

    if (!this.texture) {
      this._pendingReveal.push(lens);
    } else {
      lens._reveal();
    }
    return lens;
  }

  /* ----------------------------- */
  render() {
    const gl = this.gl;
    if (!this.texture) return;

    if (this._isScrolling) {
      this._scrollUpdateCounter++;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.u.tex, 0);

    const time = (Date.now() - this.startTime) / 1000;
    gl.uniform1f(this.u.time, time);

    this._updateDynamicVideos();

    this._updateDynamicNodes();

    this.lenses.forEach((lens) => {
      lens.updateMetrics();
      if (lens._mirrorActive && lens._mirrorClipUpdater) {
        lens._mirrorClipUpdater();
      }
      this._renderLens(lens);
    });

    this.lenses.forEach((ln) => {
      if (ln._mirrorActive && ln._mirrorCtx) {
        const mirror = ln._mirror;
        if (
          mirror.width !== this.canvas.width ||
          mirror.height !== this.canvas.height
        ) {
          mirror.width = this.canvas.width;
          mirror.height = this.canvas.height;
        }
        ln._mirrorCtx.drawImage(this.canvas, 0, 0);
      }
    });

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.lenses.forEach((ln) => {
      if (ln._mirrorActive && ln.rectPx) {
        const { left, top, width, height } = ln.rectPx;
        const expand = 2;
        const x = Math.max(0, Math.round(left * dpr) - expand);
        const y = Math.max(
          0,
          Math.round(this.canvas.height - (top + height) * dpr) - expand
        );
        const w = Math.min(
          this.canvas.width - x,
          Math.round(width * dpr) + expand * 2
        );
        const h = Math.min(
          this.canvas.height - y,
          Math.round(height * dpr) + expand * 2
        );
        if (w > 0 && h > 0) {
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(x, y, w, h);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.disable(gl.SCISSOR_TEST);
        }
      }
    });
  }

  /* ----------------------------- */
  _renderLens(lens) {
    const gl = this.gl;
    const rect = lens.rectPx;
    if (!rect) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);

    let overscrollY = 0;
    let overscrollX = 0;

    if (window.visualViewport) {
      overscrollX = window.visualViewport.offsetLeft;
      overscrollY = window.visualViewport.offsetTop;
    }

    const x = (rect.left + overscrollX) * dpr;
    const y =
      this.canvas.height - (rect.top + overscrollY + rect.height) * dpr;
    const w = rect.width * dpr;
    const h = rect.height * dpr;

    gl.viewport(x, y, w, h);
    gl.uniform2f(this.u.res, w, h);

    const docX = rect.left - this.snapshotTarget.getBoundingClientRect().left;
    const docY = rect.top - this.snapshotTarget.getBoundingClientRect().top;
    const leftUV = (docX * this.scaleFactor) / this.textureWidth;
    const topUV = (docY * this.scaleFactor) / this.textureHeight;
    const wUV = (rect.width * this.scaleFactor) / this.textureWidth;
    const hUV = (rect.height * this.scaleFactor) / this.textureHeight;
    gl.uniform4f(this.u.bounds, leftUV, topUV, wUV, hUV);

    gl.uniform2f(
      this.u.textureResolution,
      this.textureWidth,
      this.textureHeight
    );
    gl.uniform1f(this.u.refraction, lens.options.refraction);
    gl.uniform1f(this.u.bevelDepth, lens.options.bevelDepth);
    gl.uniform1f(this.u.bevelWidth, lens.options.bevelWidth);
    gl.uniform1f(this.u.frost, lens.options.frost);
    gl.uniform1f(this.u.radius, lens.radiusGl);
    gl.uniform1i(this.u.specular, lens.options.specular ? 1 : 0);
    gl.uniform1f(this.u.revealProgress, lens._revealProgress || 1.0);
    gl.uniform1i(this.u.revealType, lens.revealTypeIndex || 0);

    const mag = Math.max(
      0.001,
      Math.min(
        3.0,
        lens.options.magnify !== undefined ? lens.options.magnify : 1.0
      )
    );
    gl.uniform1f(this.u.magnify, mag);

    gl.uniform1f(this.u.tiltX, lens.tiltX || 0);
    gl.uniform1f(this.u.tiltY, lens.tiltY || 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* ----------------------------- */
  _createRoundedRectPath(ctx, w, h, radii) {
    ctx.beginPath();
    ctx.moveTo(radii.tl, 0);
    ctx.lineTo(w - radii.tr, 0);
    ctx.arcTo(w, 0, w, radii.tr, radii.tr);
    ctx.lineTo(w, h - radii.br);
    ctx.arcTo(w, h, w - radii.br, h, radii.br);
    ctx.lineTo(radii.bl, h);
    ctx.arcTo(0, h, 0, h - radii.bl, radii.bl);
    ctx.lineTo(0, radii.tl);
    ctx.arcTo(0, 0, radii.tl, 0, radii.tl);
    ctx.closePath();
  }

  /* ----------------------------- */
  _blitVideoToRegion(vid, dstX, dstY, drawW, drawH) {
    /* GPU-side path: upload the video to a scratch texture, then
       render a textured quad into the destination region of the
       main texture via framebuffer. Returns true on success. */
    const gl = this.gl;
    if (!this._vBlitProgram) return false;

    try {
      gl.bindTexture(gl.TEXTURE_2D, this._vScratchTex);
      /* Match the rest of the renderer: FLIP_Y=false on upload so
         the source's top scan-line lands at low texel-y, identical
         to the texSubImage2D path. The lens shader's
         `1.0 - localUV.y` flip then resolves correctly. */
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        vid
      );
    } catch (_) {
      return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._vBlitFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texture,
      0
    );
    const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return false;
    }

    /* Framebuffer Y axis is bottom-up; the lens-shader assumes
       "small v = canvas top" — so to match, we point the viewport
       at the BOTTOM of the destination region in framebuffer
       coords. With FLIP_Y=false on the scratch upload, the video's
       top scanline is at v=0; the simple vertex shader maps
       framebuffer-bottom → v=0 → video top → matches lens-shader
       convention. */
    gl.viewport(dstX, dstY, drawW, drawH);
    gl.disable(gl.SCISSOR_TEST);

    gl.useProgram(this._vBlitProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._vScratchTex);
    gl.uniform1i(this._vBlitTexLoc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._vBlitQuadBuf);
    gl.enableVertexAttribArray(this._vBlitPosLoc);
    gl.vertexAttribPointer(this._vBlitPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    /* Restore main render state. `_renderLens` doesn't re-bind
       the lens vertex buffer or pin the program every call (it
       was set up once at init and after each lens uses gl.uniform
       + gl.drawArrays), so we have to put everything back exactly
       the way it was. */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._lensQuadBuf);
    gl.enableVertexAttribArray(this._lensPosLoc);
    gl.vertexAttribPointer(this._lensPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.u.tex, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return true;
  }

  /* ----------------------------- */
  _updateDynamicVideos() {
    if (this._isScrolling && this._scrollUpdateCounter % 2 !== 0) return;
    if (
      !this.texture ||
      !this.staticSnapshotCanvas ||
      !this._videoNodes.length
    )
      return;
    const gl = this.gl;

    const snapRect = this.snapshotTarget.getBoundingClientRect();

    const maxLensZ = this._getMaxLensZ();

    const lensRectsForVid = this.lenses.map((ln) => ln.rectPx).filter(Boolean);

    this._videoNodes.forEach((vid) => {
      if (effectiveZ(vid) >= maxLensZ) {
        return;
      }

      if (this._isIgnored(vid) || vid.readyState < 2) return;

      const rect = vid.getBoundingClientRect();

      /* Skip videos whose document-space rect doesn't intersect any
         lens — uploading their frame to the texture is wasted work
         if no lens samples that region. This saves a per-frame
         drawImage + texSubImage2D for offscreen / out-of-flow videos
         (e.g. fullscreen players translated offscreen, hero videos
         after the user has scrolled past them). */
      const intersectsAnyLens = lensRectsForVid.some(
        (lr) =>
          rect.left < lr.left + lr.width &&
          rect.left + rect.width > lr.left &&
          rect.top < lr.top + lr.height &&
          rect.top + rect.height > lr.top
      );
      if (!intersectsAnyLens) return;

      const texX = (rect.left - snapRect.left) * this.scaleFactor;
      const texY = (rect.top - snapRect.top) * this.scaleFactor;
      const texW = rect.width * this.scaleFactor;
      const texH = rect.height * this.scaleFactor;

      const drawW = Math.round(texW);
      const drawH = Math.round(texH);

      if (drawW <= 0 || drawH <= 0) return;

      const drawX = Math.round(texX);
      const drawY = Math.round(texY);

      const maxW = this.textureWidth;
      const maxH = this.textureHeight;
      let dstX = drawX;
      let dstY = drawY;
      let srcX = 0,
        srcY = 0,
        updW = drawW,
        updH = drawH;

      if (dstX < 0) {
        srcX = -dstX;
        updW += dstX;
        dstX = 0;
      }
      if (dstY < 0) {
        srcY = -dstY;
        updH += dstY;
        dstY = 0;
      }

      if (dstX + updW > maxW) {
        updW = maxW - dstX;
      }
      if (dstY + updH > maxH) {
        updH = maxH - dstY;
      }

      if (updW <= 0 || updH <= 0) return;

      const style = window.getComputedStyle(vid);
      const scaledRadii = {
        tl: parseFloat(style.borderTopLeftRadius) * this.scaleFactor,
        tr: parseFloat(style.borderTopRightRadius) * this.scaleFactor,
        br: parseFloat(style.borderBottomRightRadius) * this.scaleFactor,
        bl: parseFloat(style.borderBottomLeftRadius) * this.scaleFactor,
      };
      const hasRadius = Object.values(scaledRadii).some((r) => r > 0);
      const fitsExactly = updW === drawW && updH === drawH;

      /* Fast path: video element straight to GPU via framebuffer
         blit. No border-radius (no clipping mask needed) and the
         destination region wasn't clipped at a texture edge (we'd
         need source UV adjustment to handle that). For the
         homepage hero this saves a 5MP `drawImage(staticBg)`, a
         5MP `drawImage(video)`, and a 5MP `texSubImage2D(canvas)`
         per frame — every frame ends up GPU-resident. */
      if (!hasRadius && fitsExactly) {
        if (this._blitVideoToRegion(vid, dstX, dstY, drawW, drawH)) {
          return;
        }
        /* Fall through to canvas path on FBO failure (tainted
           video, framebuffer-incomplete, etc.). */
      }

      if (
        this._tmpCanvas.width !== drawW ||
        this._tmpCanvas.height !== drawH
      ) {
        this._tmpCanvas.width = drawW;
        this._tmpCanvas.height = drawH;
      }

      try {
        this._tmpCtx.save();
        this._tmpCtx.clearRect(0, 0, drawW, drawH);

        if (hasRadius) {
          this._createRoundedRectPath(
            this._tmpCtx,
            drawW,
            drawH,
            scaledRadii
          );
          this._tmpCtx.clip();
          /* The static bg paints into the rounded mask's corners;
             the video paints over the centre. We only need this
             background fill when there *is* a mask — without one
             the video drawImage covers the entire tmp canvas. */
          this._tmpCtx.drawImage(
            this.staticSnapshotCanvas,
            texX,
            texY,
            texW,
            texH,
            0,
            0,
            drawW,
            drawH
          );
        }

        this._tmpCtx.drawImage(vid, 0, 0, drawW, drawH);
        this._tmpCtx.restore();
      } catch (e) {
        console.warn("liquidGL: Error drawing video frame", e);
        return;
      }

      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      if (updW !== drawW || updH !== drawH) {
        /* The destination region was clipped by texture bounds. We need
           to upload only the clipped slice of `_tmpCanvas`, otherwise
           texSubImage2D writes past the texture and Chromium throws
           GL_INVALID_OPERATION ("Level of detail outside of range"). */
        if (!this._videoUploadCanvas) {
          this._videoUploadCanvas = document.createElement("canvas");
          this._videoUploadCtx = this._videoUploadCanvas.getContext("2d");
        }
        if (
          this._videoUploadCanvas.width !== updW ||
          this._videoUploadCanvas.height !== updH
        ) {
          this._videoUploadCanvas.width = updW;
          this._videoUploadCanvas.height = updH;
        }
        this._videoUploadCtx.clearRect(0, 0, updW, updH);
        this._videoUploadCtx.drawImage(
          this._tmpCanvas,
          srcX,
          srcY,
          updW,
          updH,
          0,
          0,
          updW,
          updH
        );
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          dstX,
          dstY,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this._videoUploadCanvas
        );
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          dstX,
          dstY,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this._tmpCanvas
        );
      }
    });
  }

  /* ----------------------------- */
  _updateDynamicNodes() {
    if (this._isScrolling && this._scrollUpdateCounter % 2 !== 0) return;
    const gl = this.gl;
    if (!this.texture || !this._dynMeta) return;
    const snapRect = this.snapshotTarget.getBoundingClientRect();
    const maxLensZ = this._getMaxLensZ();

    const lensRects = this.lenses.map((ln) => ln.rectPx).filter(Boolean);

    const rectsIntersect = (a, b) =>
      a.left < b.left + b.width &&
      a.left + a.width > b.left &&
      a.top < b.top + b.height &&
      a.top + a.height > b.top;

    if (!this._compositeCtx) {
      this._compositeCtx = document.createElement("canvas").getContext("2d");
    }

    const compositeVideos = (compositeCtx, dynamicElRect) => {
      this._videoNodes.forEach((vid) => {
        if (effectiveZ(vid) >= maxLensZ) return;
        const vidRect = vid.getBoundingClientRect();

        if (
          dynamicElRect.left < vidRect.right &&
          dynamicElRect.right > vidRect.left &&
          dynamicElRect.top < vidRect.bottom &&
          dynamicElRect.bottom > vidRect.top
        ) {
          const xInComposite =
            (vidRect.left - dynamicElRect.left) * this.scaleFactor;
          const yInComposite =
            (vidRect.top - dynamicElRect.top) * this.scaleFactor;
          const wInComposite = vidRect.width * this.scaleFactor;
          const hInComposite = vidRect.height * this.scaleFactor;
          compositeCtx.drawImage(
            vid,
            xInComposite,
            yInComposite,
            wInComposite,
            hInComposite
          );
        }
      });
    };

    this._dynamicNodes.forEach((node) => {
      const el = node.el;
      const meta = this._dynMeta.get(el);
      if (!meta) return;

      /* Allow first-time capture during scroll: snapdom can't capture
         off-viewport elements, so we need to grab them as soon as they
         enter the viewport — even while still scrolling. Subsequent
         recaptures still wait for scroll-stop to avoid jank. */
      const allowDuringScroll = !meta.lastCapture;
      if (
        meta.needsRecapture &&
        !meta._capturing &&
        (allowDuringScroll || !this._isScrolling)
      ) {
        meta._capturing = true;

        captureToCanvas(el, {
          scale: this.scaleFactor,
          ignore: (n) =>
            n.tagName === "CANVAS" || n.hasAttribute("data-liquid-ignore"),
          engine: this._engine,
          /* Dynamic nodes carry live transforms; the compositor re-applies
             the element's own transform, so capture it normalised. */
          engineOptions: { outerTransforms: false },
          allowFallback: this._allowFallback,
          onEngineFallback: (next) => {
            this._engine = next;
          },
        })
          .then((cv) => {
            if (cv.width > 0 && cv.height > 0) {
              meta.lastCapture = cv;
              meta.needsRecapture = false;
            }
          })
          .catch((e) => {
            console.error("liquidGL: Dynamic element capture failed.", e);
          })
          .finally(() => {
            meta._capturing = false;
          });
      }

      if (meta.lastCapture) {
        if (meta.prevDrawRect && !(this._workerEnabled && meta._heavyAnim)) {
          /* Clamp the erase rect to the current texture bounds.
             `prevDrawRect` was recorded against an earlier texture
             which may have been larger (e.g. before an engine
             fallback resized it). Without this clamp we'd write
             past the right/bottom edge of the live texture and
             trigger GL_INVALID_OPERATION on every dynamic frame. */
          const px = Math.max(0, Math.min(meta.prevDrawRect.x, this.textureWidth));
          const py = Math.max(0, Math.min(meta.prevDrawRect.y, this.textureHeight));
          const pw = Math.max(0, Math.min(meta.prevDrawRect.w, this.textureWidth - px));
          const ph = Math.max(0, Math.min(meta.prevDrawRect.h, this.textureHeight - py));
          if (pw > 0 && ph > 0) {
            const eraseCanvas = this._compositeCtx.canvas;
            if (eraseCanvas.width !== pw || eraseCanvas.height !== ph) {
              eraseCanvas.width = pw;
              eraseCanvas.height = ph;
            }
            this._compositeCtx.drawImage(
              this.staticSnapshotCanvas,
              px,
              py,
              pw,
              ph,
              0,
              0,
              pw,
              ph
            );
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texSubImage2D(
              gl.TEXTURE_2D,
              0,
              px,
              py,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              eraseCanvas
            );
          }
        }

        const rect = el.getBoundingClientRect();
        if (
          effectiveZ(el) >= maxLensZ ||
          !document.contains(el) ||
          rect.width === 0 ||
          rect.height === 0
        ) {
          meta.prevDrawRect = null;
          return;
        }

        if (!lensRects.some((lr) => rectsIntersect(rect, lr))) {
          meta.prevDrawRect = null;
          return;
        }

        const texX = (rect.left - snapRect.left) * this.scaleFactor;
        const texY = (rect.top - snapRect.top) * this.scaleFactor;
        const drawW = Math.round(rect.width * this.scaleFactor);
        const drawH = Math.round(rect.height * this.scaleFactor);
        const drawX = Math.round(texX);
        const drawY = Math.round(texY);

        if (drawW <= 0 || drawH <= 0) return;

        const maxW = this.textureWidth;
        const maxH = this.textureHeight;
        let dstX = drawX;
        let dstY = drawY;
        let srcX = 0,
          srcY = 0,
          updW = drawW,
          updH = drawH;

        if (dstX < 0) {
          srcX = -dstX;
          updW += dstX;
          dstX = 0;
        }
        if (dstY < 0) {
          srcY = -dstY;
          updH += dstY;
          dstY = 0;
        }

        if (dstX + updW > maxW) {
          updW = maxW - dstX;
        }
        if (dstY + updH > maxH) {
          updH = maxH - dstY;
        }

        if (updW <= 0 || updH <= 0) return;

        const compositeCanvas = this._compositeCtx.canvas;
        if (
          compositeCanvas.width !== drawW ||
          compositeCanvas.height !== drawH
        ) {
          compositeCanvas.width = drawW;
          compositeCanvas.height = drawH;
        }
        this._compositeCtx.clearRect(0, 0, drawW, drawH);

        this._compositeCtx.drawImage(
          this.staticSnapshotCanvas,
          texX,
          texY,
          rect.width * this.scaleFactor,
          rect.height * this.scaleFactor,
          0,
          0,
          drawW,
          drawH
        );
        compositeVideos(this._compositeCtx, rect);

        const style = window.getComputedStyle(el);
        this._compositeCtx.save();
        this._compositeCtx.translate(drawW / 2, drawH / 2);
        if (style.transform !== "none") {
          this._compositeCtx.transform(
            ...this._parseTransform(style.transform)
          );
        }
        this._compositeCtx.translate(-drawW / 2, -drawH / 2);
        this._compositeCtx.globalAlpha = parseFloat(style.opacity) || 1.0;
        this._compositeCtx.drawImage(meta.lastCapture, 0, 0, drawW, drawH);
        this._compositeCtx.restore();

        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        /* If the in-bounds region is smaller than the composite canvas
           (snapdom's output dims can differ from fullW*scale by sub-pixels,
           so the dynamic rect can extend past the texture edge), upload only
           the clipped rectangle instead of the whole canvas. Otherwise WebGL
           rejects the upload with INVALID_VALUE on Chrome. */
        if (updW !== drawW || updH !== drawH) {
          if (!this._uploadCanvas) {
            this._uploadCanvas = document.createElement("canvas");
            this._uploadCtx = this._uploadCanvas.getContext("2d");
          }
          if (
            this._uploadCanvas.width !== updW ||
            this._uploadCanvas.height !== updH
          ) {
            this._uploadCanvas.width = updW;
            this._uploadCanvas.height = updH;
          }
          this._uploadCtx.clearRect(0, 0, updW, updH);
          this._uploadCtx.drawImage(
            compositeCanvas,
            srcX,
            srcY,
            updW,
            updH,
            0,
            0,
            updW,
            updH
          );
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            dstX,
            dstY,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this._uploadCanvas
          );
        } else {
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            dstX,
            dstY,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            compositeCanvas
          );
        }

        if (this._workerEnabled && meta._heavyAnim) {
          const jobId = `${Date.now()}_${Math.random()}`;
          this._dynJobs.set(jobId, {
            x: dstX,
            y: dstY,
            w: updW,
            h: updH,
          });

          Promise.all([
            createImageBitmap(
              this.staticSnapshotCanvas,
              dstX,
              dstY,
              updW,
              updH
            ),
            createImageBitmap(meta.lastCapture),
          ]).then(([snapBmp, dynBmp]) => {
            this._dynWorker.postMessage(
              {
                id: jobId,
                width: updW,
                height: updH,
                snap: snapBmp,
                dyn: dynBmp,
              },
              [snapBmp, dynBmp]
            );
          });
          meta.prevDrawRect = { x: dstX, y: dstY, w: updW, h: updH };
          return;
        }

        meta.prevDrawRect = { x: dstX, y: dstY, w: updW, h: updH };
      }
    });
  }

  _parseTransform(transform) {
    if (transform === "none") return [1, 0, 0, 1, 0, 0];
    const matrixMatch = transform.match(/matrix\((.+)\)/);
    if (matrixMatch) {
      const values = matrixMatch[1].split(",").map(parseFloat);
      return values;
    }
    const matrix3dMatch = transform.match(/matrix3d\((.+)\)/);
    if (matrix3dMatch) {
      const v = matrix3dMatch[1].split(",").map(parseFloat);
      return [v[0], v[1], v[4], v[5], v[12], v[13]];
    }
    return [1, 0, 0, 1, 0, 0];
  }

  /* ----------------------------- */
  _getMaxLensZ() {
    let maxZ = 0;
    this.lenses.forEach((ln) => {
      const z = effectiveZ(ln.el);
      if (z > maxZ) maxZ = z;
    });
    return maxZ;
  }

  /* ----------------------------- */
  addDynamicElement(el) {
    if (!el) return;
    if (typeof el === "string") {
      this.snapshotTarget
        .querySelectorAll(el)
        .forEach((n) => this.addDynamicElement(n));
      return;
    }
    if (NodeList.prototype.isPrototypeOf(el) || Array.isArray(el)) {
      Array.from(el).forEach((n) => this.addDynamicElement(n));
      return;
    }
    if (!el.getBoundingClientRect) return;
    if (el.closest && el.closest("[data-liquid-ignore]")) return;
    if (this._dynamicNodes.some((n) => n.el === el)) return;

    this._dynamicNodes = this._dynamicNodes.filter((n) => !el.contains(n.el));

    const meta = {
      _capturing: false,
      prevDrawRect: null,
      lastCapture: null,
      needsRecapture: true,
      hoverClassName: null,
      _animating: false,
      _rafId: null,
      _lastCaptureTs: 0,
      _heavyAnim: false,
    };
    this._dynMeta.set(el, meta);

    /* snapdom only captures content that's currently rendered in the
       viewport — anything off-screen comes back as an empty canvas.
       Re-mark for capture each time the element enters the viewport
       (with a generous rootMargin so we catch it just before scroll). */
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        (entries) => {
          const m = this._dynMeta.get(el);
          if (!m) return;
          for (let i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              m.needsRecapture = true;
              requestAnimationFrame(() => this.render());
              break;
            }
          }
        },
        { rootMargin: "200px" }
      );
      io.observe(el);
      meta._viewportObserver = io;
    }

    const setDirty = () => {
      const m = this._dynMeta.get(el);
      if (m && !m.needsRecapture) {
        m.needsRecapture = true;
        requestAnimationFrame(() => this.render());
      }
    };

    const findAppliedHoverStyles = (element) => {
      let cssText = "";
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (!rule.selectorText || !rule.selectorText.includes(":hover")) {
              continue;
            }
            const baseSelector = rule.selectorText.split(":hover")[0];
            if (element.matches(baseSelector)) {
              cssText += rule.style.cssText;
            }
          }
        } catch (e) {}
      }
      return cssText;
    };

    const handleLeave = () => {
      const m = this._dynMeta.get(el);
      if (!m || !m.hoverClassName) return;

      el.classList.remove(m.hoverClassName);
      for (let i = this._dynamicStyleSheet.cssRules.length - 1; i >= 0; i--) {
        const rule = this._dynamicStyleSheet.cssRules[i];
        if (rule.selectorText === `.${m.hoverClassName}`) {
          this._dynamicStyleSheet.deleteRule(i);
          break;
        }
      }
      m.hoverClassName = null;
      setDirty();
    };

    el.addEventListener(
      "mouseenter",
      () => {
        const m = this._dynMeta.get(el);
        if (!m) return;
        const hoverCss = findAppliedHoverStyles(el);
        if (hoverCss) {
          const className = `lqgl-h-${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          const rule = `.${className} { ${hoverCss} }`;
          try {
            this._dynamicStyleSheet.insertRule(
              rule,
              this._dynamicStyleSheet.cssRules.length
            );
            m.hoverClassName = className;
            el.classList.add(className);
          } catch (e) {
            console.error("liquidGL: Failed to insert hover style rule.", e);
          }
        }
        setDirty();
      },
      { passive: true }
    );

    el.addEventListener("mouseleave", handleLeave, { passive: true });
    el.addEventListener("transitionend", setDirty, { passive: true });

    const startRealtime = () => {
      const m = this._dynMeta.get(el);
      if (!m || m._animating) return;
      m._animating = true;

      m._heavyAnim = false;

      const step = (ts) => {
        const meta = this._dynMeta.get(el);
        if (!meta || !meta._animating) return;

        if (
          meta._heavyAnim &&
          !meta._capturing &&
          ts - meta._lastCaptureTs > 33
        ) {
          meta._lastCaptureTs = ts;
          meta.needsRecapture = true;
        }
        if (meta._heavyAnim) {
          meta._rafId = requestAnimationFrame(step);
        } else {
          meta._rafId = null;
        }
      };
      m._rafId = requestAnimationFrame(step);
    };

    const trackProperty = (prop) => {
      const m = this._dynMeta.get(el);
      if (!m) return;
      const low = (prop || "").toLowerCase();
      if (!(low.includes("transform") || low.includes("opacity"))) {
        const wasHeavy = m._heavyAnim;
        m._heavyAnim = true;
        if (m._animating && !wasHeavy && !m._rafId) {
          m._animating = false;
          startRealtime();
        }
      }
    };

    const transitionRunHandler = (e) => {
      trackProperty(e.propertyName);
      startRealtime();
    };

    el.addEventListener("transitionrun", transitionRunHandler, {
      passive: true,
    });
    el.addEventListener("transitionstart", transitionRunHandler, {
      passive: true,
    });
    el.addEventListener(
      "animationstart",
      () => {
        const m = this._dynMeta.get(el);
        if (m) m._heavyAnim = true;
        startRealtime();
      },
      { passive: true }
    );

    el.addEventListener(
      "animationiteration",
      () => {
        const m = this._dynMeta.get(el);
        if (m) {
          m._heavyAnim = true;
          if (!m._animating) startRealtime();
        }
      },
      { passive: true }
    );

    const stopRealtime = () => {
      const m = this._dynMeta.get(el);
      if (!m || !m._animating) return;
      m._animating = false;
      if (m._rafId) {
        cancelAnimationFrame(m._rafId);
        m._rafId = null;
      }
      m._heavyAnim = false;
      setDirty();
    };

    el.addEventListener("transitionend", stopRealtime, { passive: true });
    el.addEventListener("transitioncancel", stopRealtime, { passive: true });
    el.addEventListener("animationend", stopRealtime, { passive: true });
    el.addEventListener("animationcancel", stopRealtime, { passive: true });

    /* --------------------------------------------------
     *  Removal clean-up
     * --------------------------------------------------*/
    if (typeof MutationObserver !== "undefined") {
      const removalObserver = new MutationObserver(() => {
        if (!document.contains(el)) {
          handleLeave();
          removalObserver.disconnect();
          this._dynamicNodes = this._dynamicNodes.filter((n) => n.el !== el);
          this._dynMeta.delete(el);
        }
      });
      removalObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    this._dynamicNodes.push({ el });
  }

  /* ----------------------------- */
  _isIgnored(el) {
    return !!(
      el &&
      typeof el.closest === "function" &&
      el.closest("[data-liquid-ignore]")
    );
  }
}
