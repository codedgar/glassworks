/* Per-element lens: geometry, reveal, tilt and the shadow/mirror helpers. */
import { effectiveZ } from "./util.js";

/* --------------------------------------------------
 *  Per-element lens wrapper
 * ------------------------------------------------*/
export class liquidGLLens {
  constructor(renderer, element, options) {
    this.renderer = renderer;
    this.el = element;
    this.options = options;
    this._initCalled = false;
    this.rectPx = null;
    this.radiusGl = 0;
    this.radiusCss = 0;
    this.revealTypeIndex = this.options.reveal === "fade" ? 1 : 0;
    this._revealProgress = this.revealTypeIndex === 0 ? 1 : 0;
    this.tiltX = 0;
    this.tiltY = 0;

    this.originalShadow = this.el.style.boxShadow;
    this.originalOpacity = this.el.style.opacity;
    this.originalTransition = this.el.style.transition;
    this.el.style.transition = "none";
    this.el.style.opacity = 0;

    this.el.style.position =
      this.el.style.position === "static"
        ? "relative"
        : this.el.style.position;

    const bgCol = window.getComputedStyle(this.el).backgroundColor;
    const rgbaMatch = bgCol.match(/rgba?\(([^)]+)\)/);
    this._bgColorComponents = null;
    if (rgbaMatch) {
      const comps = rgbaMatch[1].split(/[ ,]+/).map(parseFloat);
      const [r, g, b, a = 1] = comps;
      this._bgColorComponents = { r, g, b, a };
      this.el.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0)`;
    }

    this.el.style.backdropFilter = "none";
    this.el.style.webkitBackdropFilter = "none";
    this.el.style.backgroundImage = "none";
    this.el.style.background = "transparent";

    this.el.style.pointerEvents = "none";

    this.updateMetrics();
    this.setShadow(this.options.shadow);
    if (this.options.tilt) this._bindTiltHandlers();

    if (typeof ResizeObserver !== "undefined" && !this._sizeObs) {
      this._sizeObs = new ResizeObserver(() => {
        this.updateMetrics();
        this.renderer.render();
      });
      this._sizeObs.observe(this.el);
    }
  }

  /* ----------------------------- */
  updateMetrics() {
    const rect =
      this._mirrorActive && this._baseRect
        ? this._baseRect
        : this.el.getBoundingClientRect();

    this.rectPx = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };

    const style = window.getComputedStyle(this.el);
    const brRaw = style.borderTopLeftRadius.split(" ")[0];
    const isPct = brRaw.trim().endsWith("%");
    let brPx;
    if (isPct) {
      const pct = parseFloat(brRaw);
      brPx = (Math.min(rect.width, rect.height) * pct) / 100;
    } else {
      brPx = parseFloat(brRaw);
    }
    const maxAllowedCss = Math.min(rect.width, rect.height) * 0.5;
    this.radiusCss = Math.min(brPx, maxAllowedCss);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.radiusGl = this.radiusCss * dpr;

    if (this._shadowSyncFn) {
      this._shadowSyncFn();
    }
  }

  /* ----------------------------- */
  _handleOverscrollCompensation() {
    let overscrollY = 0;
    let overscrollX = 0;

    if (window.visualViewport) {
      overscrollX = -window.visualViewport.offsetLeft;
      overscrollY = -window.visualViewport.offsetTop;
    } else {
      const bodyStyle = window.getComputedStyle(document.body);
      const htmlStyle = window.getComputedStyle(document.documentElement);

      if (bodyStyle.transform && bodyStyle.transform !== "none") {
        const matrix = new DOMMatrix(bodyStyle.transform);
        overscrollX = matrix.m41;
        overscrollY = matrix.m42;
      }

      if (
        overscrollY === 0 &&
        overscrollX === 0 &&
        htmlStyle.transform &&
        htmlStyle.transform !== "none"
      ) {
        const matrix = new DOMMatrix(htmlStyle.transform);
        overscrollX = matrix.m41;
        overscrollY = matrix.m42;
      }
    }

    this._currentOverscrollX = overscrollX;
    this._currentOverscrollY = overscrollY;

    if (overscrollY !== 0 || overscrollX !== 0) {
      const compensationTransform = `translate(${-overscrollX}px, ${-overscrollY}px)`;

      let currentTransform = this.el.style.transform;
      currentTransform = currentTransform
        .replace(/translate\([^)]*\)\s*/g, "")
        .trim();

      this.el.style.transform =
        compensationTransform +
        (currentTransform ? " " + currentTransform : "");

      if (this._shadowEl) {
        let shadowTransform = this._shadowEl.style.transform || "";
        shadowTransform = shadowTransform
          .replace(/translate\([^)]*\)\s*/g, "")
          .trim();
        this._shadowEl.style.transform =
          compensationTransform +
          (shadowTransform ? " " + shadowTransform : "");
      }
    } else if (!this._tiltInteracting) {
      this.el.style.transform = this._savedTransform || "";
      if (this._shadowEl) {
        this._shadowEl.style.transform = "";
      }
    }
  }

  /* ----------------------------- */
  setTilt(enabled) {
    this.options.tilt = !!enabled;
    if (this.options.tilt) {
      this._bindTiltHandlers();
    } else {
      this._unbindTiltHandlers();
    }
  }

  /* ----------------------------- */
  setShadow(enabled) {
    this.options.shadow = !!enabled;

    const SHADOW_VAL =
      "0 10px 30px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.05)";

    const syncShadow = () => {
      if (!this._shadowEl) return;
      const r =
        this._mirrorActive && this._baseRect
          ? this._baseRect
          : this.el.getBoundingClientRect();
      this._shadowEl.style.left = `${r.left}px`;
      this._shadowEl.style.top = `${r.top}px`;
      this._shadowEl.style.width = `${r.width}px`;
      this._shadowEl.style.height = `${r.height}px`;
      this._shadowEl.style.borderRadius = `${this.radiusCss}px`;
    };

    if (enabled) {
      this.el.style.boxShadow = SHADOW_VAL;

      if (!this._shadowEl) {
        this._shadowEl = document.createElement("div");
        Object.assign(this._shadowEl.style, {
          position: "fixed",
          pointerEvents: "none",
          zIndex: effectiveZ(this.el) - 2,
          boxShadow: SHADOW_VAL,
          willChange: "transform, width, height",
          opacity: this.revealTypeIndex === 1 ? 0 : 1,
        });
        document.body.appendChild(this._shadowEl);

        this._shadowSyncFn = syncShadow;
        window.addEventListener("resize", this._shadowSyncFn, {
          passive: true,
        });
      }
      syncShadow();
    } else {
      if (this._shadowEl) {
        window.removeEventListener("resize", this._shadowSyncFn);
        this._shadowEl.remove();
        this._shadowEl = null;
      }
      this.el.style.boxShadow = this.originalShadow;
    }
  }

  /* ----------------------------- */
  _reveal() {
    if (this.revealTypeIndex === 0) {
      this.el.style.opacity = this.originalOpacity || 1;
      this.renderer.canvas.style.opacity = "1";
      this._revealProgress = 1;
      this._TriggerInit();
      return;
    }

    if (this.renderer._revealAnimating) return;

    this.renderer._revealAnimating = true;

    const dur = 1000;
    const start = performance.now();

    const animate = () => {
      const progress = Math.min(1, (performance.now() - start) / dur);

      this.renderer.lenses.forEach((ln) => {
        ln._revealProgress = progress;
        ln.el.style.opacity = (ln.originalOpacity || 1) * progress;
        if (ln._shadowEl) {
          ln._shadowEl.style.opacity = progress;
        }
      });

      this.renderer.canvas.style.opacity = String(progress);

      this.renderer.render();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.renderer._revealAnimating = false;
        this.renderer.lenses.forEach((ln) => {
          ln.el.style.transition = ln.originalTransition || "";
          ln._TriggerInit();
        });
      }
    };

    requestAnimationFrame(animate);
  }

  /* ----------------------------- */
  _bindTiltHandlers() {
    if (this._tiltHandlersBound) return;

    if (this._savedTransform === undefined) {
      const currentTransform = this.el.style.transform;
      if (currentTransform && currentTransform.includes("translate")) {
        this._savedTransform = currentTransform
          .replace(/translate\([^)]*\)\s*/g, "")
          .trim();
        if (this._savedTransform === "") this._savedTransform = "none";
      } else {
        this._savedTransform = currentTransform;
      }
    }
    if (this._savedTransformStyle === undefined) {
      this._savedTransformStyle = this.el.style.transformStyle;
    }
    this.el.style.transformStyle = "preserve-3d";

    const getMaxTilt = () =>
      Number.isFinite(this.options.tiltFactor) ? this.options.tiltFactor : 5;

    this._applyTilt = (clientX, clientY) => {
      if (!this._tiltInteracting) {
        this._tiltInteracting = true;
        this.el.style.transition =
          "transform 0.12s cubic-bezier(0.33,1,0.68,1)";
        this._createMirrorCanvas();
        if (this._mirror) {
          this._mirror.style.transition =
            "transform 0.12s cubic-bezier(0.33,1,0.68,1)";
        }
        if (this._shadowEl) {
          this._shadowEl.style.transition =
            "transform 0.12s cubic-bezier(0.33,1,0.68,1)";
        }
      }

      const r = this._baseRect || this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      this._pivotOrigin = `${cx}px ${cy}px`;

      const pctX = (clientX - cx) / (r.width / 2);
      const pctY = (clientY - cy) / (r.height / 2);
      const maxTilt = getMaxTilt();
      const rotY = pctX * maxTilt;
      const rotX = -pctY * maxTilt;
      const baseTransform =
        this._savedTransform && this._savedTransform !== "none"
          ? this._savedTransform + " "
          : "";

      let overscrollCompensation = "";
      const bodyStyle = window.getComputedStyle(document.body);
      if (bodyStyle.transform && bodyStyle.transform !== "none") {
        const matrix = new DOMMatrix(bodyStyle.transform);
        const overscrollX = matrix.m41;
        const overscrollY = matrix.m42;
        if (overscrollX !== 0 || overscrollY !== 0) {
          overscrollCompensation = `translate(${-overscrollX}px, ${-overscrollY}px) `;
        }
      }

      const transformStr = `${overscrollCompensation}${baseTransform}perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;

      this.tiltX = rotX;
      this.tiltY = rotY;

      this.el.style.transformOrigin = `50% 50%`;
      this.el.style.transform = transformStr;

      if (this._mirror) {
        this._mirror.style.transformOrigin = this._pivotOrigin;
        this._mirror.style.transform = transformStr;
      }

      if (this._shadowEl) {
        this._shadowEl.style.transformOrigin = `50% 50%`;
        this._shadowEl.style.transform = transformStr;
      }

      this.renderer.render();
    };

    this._smoothReset = () => {
      this.el.style.transition = "transform 0.4s cubic-bezier(0.33,1,0.68,1)";
      this.el.style.transformOrigin = `50% 50%`;
      const baseRest =
        this._savedTransform && this._savedTransform !== "none"
          ? this._savedTransform + " "
          : "";

      let overscrollCompensation = "";
      const bodyStyle = window.getComputedStyle(document.body);
      if (bodyStyle.transform && bodyStyle.transform !== "none") {
        const matrix = new DOMMatrix(bodyStyle.transform);
        const overscrollX = matrix.m41;
        const overscrollY = matrix.m42;
        if (overscrollX !== 0 || overscrollY !== 0) {
          overscrollCompensation = `translate(${-overscrollX}px, ${-overscrollY}px) `;
        }
      }

      this.el.style.transform = `${overscrollCompensation}${baseRest}perspective(800px) rotateX(0deg) rotateY(0deg)`;

      this.tiltX = 0;
      this.tiltY = 0;
      this.renderer.render();

      if (this._mirror) {
        this._mirror.style.transition =
          "transform 0.4s cubic-bezier(0.33, 1, 0.68, 1)";
        this._mirror.style.transformOrigin = this._pivotOrigin || "50% 50%";
        this._mirror.style.transform = `${baseRest}perspective(800px) rotateX(0deg) rotateY(0deg)`;
        const clean = () => {
          this._destroyMirrorCanvas();
          this._resetCleanupTimer = null;
        };
        this._mirror.addEventListener("transitionend", clean, {
          once: true,
        });
        this._resetCleanupTimer = setTimeout(clean, 350);
      }

      if (this._shadowEl) {
        this._shadowEl.style.transition =
          "transform 0.4s cubic-bezier(0.33,1,0.68,1)";
        this._shadowEl.style.transformOrigin = `50% 50%`;
        this._shadowEl.style.transform = `${baseRest}perspective(800px) rotateX(0deg) rotateY(0deg)`;
      }
    };

    this._onMouseEnter = (e) => {
      if (this._resetCleanupTimer) {
        clearTimeout(this._resetCleanupTimer);
        this._resetCleanupTimer = null;
        this._destroyMirrorCanvas();
        this.el.style.transition = "none";
        this.el.style.transform = this._savedTransform || "";
        void this.el.offsetHeight;
      }

      this._tiltInteracting = false;
      this._createMirrorCanvas();

      const r = this._baseRect || this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      this._applyTilt(cx, cy);

      if (e && typeof e.clientX === "number") {
        requestAnimationFrame(() => {
          this._applyTilt(e.clientX, e.clientY);
        });
      }

      document.addEventListener("mousemove", this._boundCheckLeave, {
        passive: true,
      });
    };

    this._onMouseMove = (e) => this._applyTilt(e.clientX, e.clientY);

    this._onTouchStart = (e) => {
      this._tiltInteracting = false;
      this._createMirrorCanvas();
      if (e.touches && e.touches.length === 1) {
        const t = e.touches[0];
        this._applyTilt(t.clientX, t.clientY);
      }
    };
    this._onTouchMove = (e) => {
      if (e.touches && e.touches.length === 1) {
        const t = e.touches[0];
        this._applyTilt(t.clientX, t.clientY);
      }
    };
    this._onTouchEnd = () => {
      this._smoothReset();
    };

    this.el.addEventListener("mouseenter", this._onMouseEnter.bind(this), {
      passive: true,
    });
    this.el.addEventListener("mousemove", this._onMouseMove.bind(this), {
      passive: true,
    });
    this.el.addEventListener("touchstart", this._onTouchStart.bind(this), {
      passive: true,
    });
    this.el.addEventListener("touchmove", this._onTouchMove.bind(this), {
      passive: true,
    });
    this.el.addEventListener("touchend", this._onTouchEnd.bind(this), {
      passive: true,
    });

    /* ----------------------------- */
    this._tiltActive = false;

    this._docPointerMove = (e) => {
      const x = e.clientX ?? (e.touches && e.touches[0].clientX);
      const y = e.clientY ?? (e.touches && e.touches[0].clientY);
      if (x === undefined || y === undefined) return;

      const r = this.el.getBoundingClientRect();
      const inside =
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

      if (inside) {
        if (!this._tiltActive) {
          this._tiltActive = true;
          this._onMouseEnter({ clientX: x, clientY: y });
        } else {
          this._applyTilt(x, y);
        }
      } else if (this._tiltActive) {
        this._tiltActive = false;
        this._smoothReset();
      }
    };

    document.addEventListener("pointermove", this._docPointerMove, {
      passive: true,
    });

    this._tiltHandlersBound = true;
  }

  _unbindTiltHandlers() {
    if (!this._tiltHandlersBound) return;
    this.el.removeEventListener("mouseenter", this._onMouseEnter.bind(this));
    this.el.removeEventListener("mousemove", this._onMouseMove.bind(this));
    document.removeEventListener("mousemove", this._boundCheckLeave);
    this.el.removeEventListener("touchstart", this._onTouchStart.bind(this));
    this.el.removeEventListener("touchmove", this._onTouchMove.bind(this));
    this.el.removeEventListener("touchend", this._onTouchEnd.bind(this));

    if (this._docPointerMove) {
      document.removeEventListener("pointermove", this._docPointerMove);
      this._docPointerMove = null;
    }
    this._tiltHandlersBound = false;

    this.el.style.transform = this._savedTransform || "";
    this.el.style.transformStyle = this._savedTransformStyle || "";

    this.renderer.render();
  }

  _createMirrorCanvas() {
    this._baseRect = this.el.getBoundingClientRect();
    if (this._mirror) return;
    this._mirror = document.createElement("canvas");
    Object.assign(this._mirror.style, {
      position: "fixed",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: effectiveZ(this.el) - 1,
      willChange: "transform",
    });
    this._mirrorCtx = this._mirror.getContext("2d");
    document.body.appendChild(this._mirror);

    const updateClip = () => {
      if (this._mirrorActive) {
        this._baseRect = this._baseRect || this.el.getBoundingClientRect();
      }
      const r = this._baseRect || this.el.getBoundingClientRect();
      const radius = `${this.radiusCss}px`;
      this._mirror.style.clipPath = `inset(${r.top}px ${
        innerWidth - r.right
      }px ${innerHeight - r.bottom}px ${r.left}px round ${radius})`;
      this._mirror.style.webkitClipPath = this._mirror.style.clipPath;
    };
    updateClip();
    this._mirrorClipUpdater = updateClip;
    window.addEventListener("resize", updateClip, { passive: true });

    this._mirrorActive = true;
  }

  _destroyMirrorCanvas() {
    if (!this._mirror) return;
    window.removeEventListener("resize", this._mirrorClipUpdater);
    this._mirror.remove();
    this._mirror = this._mirrorCtx = null;
    this._baseRect = null;
    this._mirrorActive = false;
  }

  /** Used when no capture engine is available: restore the element so it does
   *  not stay invisible, and let on.init fire so callers are not left hanging. */
  _revealWithoutTexture() {
    this.el.style.opacity = this.originalOpacity || 1;
    this.el.style.transition = this.originalTransition || "";
    this._TriggerInit();
  }

  _TriggerInit() {
    if (this._initCalled) return;
    this._initCalled = true;
    if (this.options.on && this.options.on.init) {
      this.options.on.init(this);
    }
  }
}
