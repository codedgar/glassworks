/* Public API. The renderer is a per-page singleton, as before. */
import { liquidGLRenderer } from "./renderer.js";

/* --------------------------------------------------
 *  Public API
 * ------------------------------------------------*/
export function glassworks(userOptions = {}) {
  const defaults = {
    target: ".liquidGL",
    snapshot: "body",
    resolution: 2.0,
    refraction: 0.01,
    bevelDepth: 0.08,
    bevelWidth: 0.15,
    frost: 0,
    shadow: true,
    specular: true,
    reveal: "fade",
    tilt: false,
    tiltFactor: 5,
    magnify: 1,
    engine: "snapdom",
    on: {},
  };
  const options = { ...defaults, ...userOptions };

  if (typeof window.__liquidGLNoWebGL__ === "undefined") {
    const testCanvas = document.createElement("canvas");
    const testCtx =
      testCanvas.getContext("webgl2") ||
      testCanvas.getContext("webgl") ||
      testCanvas.getContext("experimental-webgl");
    window.__liquidGLNoWebGL__ = !testCtx;
  }

  const noWebGL = window.__liquidGLNoWebGL__;

  if (noWebGL) {
    console.warn(
      "liquidGL: WebGL not available – falling back to CSS backdrop-filter."
    );
    const fallbackNodes = document.querySelectorAll(options.target);
    fallbackNodes.forEach((node) => {
      Object.assign(node.style, {
        background: "rgba(255, 255, 255, 0.07)",
        backdropFilter: "blur(12px)",
        webkitBackdropFilter: "blur(12px)",
      });
    });
    return fallbackNodes.length === 1
      ? fallbackNodes[0]
      : Array.from(fallbackNodes);
  }

  let renderer = window.__liquidGLRenderer__;
  if (!renderer) {
    renderer = new liquidGLRenderer(
      options.snapshot,
      options.resolution,
      options.engine
    );
    window.__liquidGLRenderer__ = renderer;
  }

  const nodeList = document.querySelectorAll(options.target);
  if (!nodeList || nodeList.length === 0) {
    console.warn(
      `liquidGL: Target element(s) '${options.target}' not found.`
    );
    return;
  }

  const instances = Array.from(nodeList).map((el) =>
    renderer.addLens(el, options)
  );

  if (!renderer._rafId && !renderer.useExternalTicker) {
    const loop = () => {
      renderer.render();
      renderer._rafId = requestAnimationFrame(loop);
    };
    renderer._rafId = requestAnimationFrame(loop);
  }

  return instances.length === 1 ? instances[0] : instances;
};

/* --------------------------------------------------
 *  Public helper: register elements that need live updates
 *  Multiple calls in the same task tick are coalesced into a
 *  single recapture (the homepage registers split lines and
 *  containers separately, which previously triggered three
 *  full-page captures back-to-back).
 * ------------------------------------------------*/
glassworks.registerDynamic = function (elements) {
  const renderer = window.__liquidGLRenderer__;
  if (!renderer || !renderer.addDynamicElement) return;
  renderer.addDynamicElement(elements);
  if (!renderer.captureSnapshot) return;
  if (renderer._captureRequested) return;
  renderer._captureRequested = true;
  Promise.resolve().then(() => {
    renderer._captureRequested = false;
    renderer.captureSnapshot();
  });
};

/* --------------------------------------------------
 *  Public helper: Universal smooth scroll / animation sync
 * ------------------------------------------------*/
glassworks.syncWith = function (config = {}) {
  const renderer = window.__liquidGLRenderer__;
  if (!renderer) {
    console.warn(
      "liquidGL: Please initialize liquidGL *before* calling syncWith()."
    );
    return;
  }

  const G = window.gsap;
  const L = window.Lenis;
  const LS = window.LocomotiveScroll;
  const ST = G ? G.ScrollTrigger : null;

  let lenis = config.lenis;
  let loco = config.locomotiveScroll;
  const useGSAP = config.gsap !== false && G && ST;

  if (config.lenis !== false && L && !lenis) {
    lenis = new L();
  }

  if (
    config.locomotiveScroll !== false &&
    LS &&
    !loco &&
    document.querySelector("[data-scroll-container]")
  ) {
    loco = new LS({
      el: document.querySelector("[data-scroll-container]"),
      smooth: true,
    });
  }

  if (useGSAP && ST) {
    if (loco) {
      loco.on("scroll", ST.update);
      ST.scrollerProxy(loco.el, {
        scrollTop(value) {
          return arguments.length
            ? loco.scrollTo(value, { duration: 0, disableLerp: true })
            : loco.scroll.instance.scroll.y;
        },
        getBoundingClientRect() {
          return {
            top: 0,
            left: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          };
        },
        pinType: loco.el.style.transform ? "transform" : "fixed",
      });
      ST.addEventListener("refresh", () => loco.update());
      ST.refresh();
    } else if (lenis) {
      lenis.on("scroll", ST.update);
    }
  }

  if (renderer._rafId) {
    cancelAnimationFrame(renderer._rafId);
    renderer._rafId = null;
  }
  renderer.useExternalTicker = true;

  if (useGSAP) {
    G.ticker.add((time) => {
      if (lenis) lenis.raf(time * 1000);
      renderer.render();
    });
    G.ticker.lagSmoothing(0);
  } else {
    const loop = (time) => {
      if (lenis) lenis.raf(time);
      if (loco) loco.update();
      renderer.render();
      renderer._rafId = requestAnimationFrame(loop);
    };
    renderer._rafId = requestAnimationFrame(loop);
  }

  return { lenis, locomotiveScroll: loco };
};
