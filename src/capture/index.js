/* Capture orchestration: hide ignored elements, inject background-image
 * shims, run the engine, and fall back to html2canvas when the engine fails
 * or returns an incomplete canvas. */
import { testOpt } from "../test-hooks.js";
import { injectBackgroundImageShims } from "./bg-shim.js";
import { snapshotLooksComplete } from "./complete.js";
import { captureViaHtml2canvas, canLazyLoadHtml2canvas } from "./html2canvas.js";
import { resolveEngine, GlassworksEngineError, noEngineMessage } from "./engines.js";

export async function captureToCanvas(
  target,
  {
    scale,
    ignore,
    engine,
    engineOptions,
    onEngineFallback,
    validateCompleteness,
    allowFallback = true,
    testInfo,
  } = {}
) {
  const requestedName =
    engine && typeof engine === "object" ? engine.name || "custom" : engine || "snapdom";
  const rawEngine = !!testInfo && !!testOpt("rawEngine");

  if (requestedName === "html2canvas") {
    if (testInfo) testInfo.engine = "html2canvas";
    return await captureViaHtml2canvas(target, { scale, ignore, engine: resolveEngine("html2canvas") });
  }

  const adapter = resolveEngine(engine);
  if (!adapter) {
    /* No engine: fail loudly. Silently returning would leave every lens
       invisible with nothing in the console to explain it. */
    if (testInfo) {
      testInfo.fallbackReason = "engine-unavailable";
      if (rawEngine) {
        testInfo.fallbackSuppressed = true;
        throw new GlassworksEngineError(noEngineMessage(requestedName));
      }
      testInfo.fallbackRan = true;
      testInfo.engine = "html2canvas";
    }
    if (!allowFallback || !canLazyLoadHtml2canvas()) {
      throw new GlassworksEngineError(noEngineMessage(requestedName));
    }
    console.warn(
      `Glassworks: capture engine "${requestedName}" is not available — falling back to html2canvas. ` +
        "Pass an engine adapter to avoid the lazy CDN load."
    );
    if (typeof onEngineFallback === "function") onEngineFallback("html2canvas");
    return await captureViaHtml2canvas(target, { scale, ignore });
  }

  /* Hide ignored elements via live-DOM `visibility: hidden`. Layout
     is preserved (visibility, unlike display:none, keeps the box
     around) and we restore in `finally` so the page is never left
     in a half-modified state if snapdom throws or the renderer
     calls cancel. */
  const tHide0 = testInfo ? performance.now() : 0;
  const restores = [];
  if (typeof ignore === "function") {
    const all = target.querySelectorAll("*");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      try {
        if (ignore(el)) {
          const prev = el.style.visibility;
          el.style.visibility = "hidden";
          restores.push(() => {
            el.style.visibility = prev;
          });
        }
      } catch (_) {
        /* defensive: predicates that throw on detached / shadow nodes */
      }
    }
  }

  /* Inject `<img>` shims for elements styled with `background-image:
     url(...)`. snapdom on WebKit can't paint CSS bg-images inside
     its `<foreignObject>` clone, but `<img>` tags work fine. The
     shims paint identically to the live bg, so injection is
     visually invisible to anyone watching the page. The same
     WebKit bug affects html2canvas, so we keep the shims in place
     through the fallback path too. */
  const tShim0 = testInfo ? performance.now() : 0;
  if (testInfo) testInfo.timings.hideMs = tShim0 - tHide0;
  const bgShimCleanups =
    testInfo && testOpt("bgShim") === false
      ? []
      : await injectBackgroundImageShims(target);
  if (testInfo) {
    testInfo.timings.bgShimMs = performance.now() - tShim0;
    testInfo.bgShimCount = bgShimCleanups.length;
  }

  const cleanupAllShims = () => {
    for (let i = bgShimCleanups.length - 1; i >= 0; i--) {
      try { bgShimCleanups[i](); } catch (_) {}
    }
    bgShimCleanups.length = 0;
  };

  let canvas;
  let snapdomThrew = false;
  const tSnap0 = testInfo ? performance.now() : 0;
  try {
    canvas = await adapter.capture(target, { scale, ignore, options: engineOptions });
  } catch (e) {
    snapdomThrew = true;
    if (testInfo) testInfo.snapdomError = String((e && e.message) || e);
    console.warn(
      `Glassworks: ${adapter.name} capture threw — falling back to html2canvas.`,
      e
    );
  } finally {
    for (let i = restores.length - 1; i >= 0; i--) {
      restores[i]();
    }
  }

  /* Completeness check is only meaningful for full-page snapshots
     — dynamic element captures legitimately contain transparent
     regions (e.g. a SplitText line with mostly empty bg) that would
     trigger a false-positive fallback otherwise. */
  const shouldValidate = validateCompleteness === true;

  if (testInfo) {
    testInfo.timings.snapdomMs = performance.now() - tSnap0;
    testInfo.engine = adapter.name;
    testInfo.completenessChecked = shouldValidate && !snapdomThrew;
  }

  if (snapdomThrew || (shouldValidate && !snapshotLooksComplete(canvas))) {
    if (!allowFallback) {
      /* fallback: false — report what would have happened and hand back the
         engine's own result. An html2canvas capture can fail outright on
         modern CSS (e.g. color-mix()), so opting out is a valid choice. */
      if (testInfo) {
        testInfo.fallbackReason = snapdomThrew ? "engine-threw" : "incomplete-canvas";
        testInfo.fallbackSuppressed = true;
      }
      cleanupAllShims();
      if (snapdomThrew) {
        throw new Error(
          `Glassworks: ${adapter.name} capture failed and fallback is disabled: ` +
            ((testInfo && testInfo.snapdomError) || "unknown error")
        );
      }
      console.warn(
        `Glassworks: ${adapter.name} returned an incomplete canvas; fallback is disabled, using it as-is.`
      );
      return canvas;
    }
    if (testInfo) {
      testInfo.fallbackReason = snapdomThrew
        ? "engine-threw"
        : "incomplete-canvas";
      if (rawEngine) {
        /* Raw-engine mode: report what would have triggered the
           fallback, but hand back snapdom's own result. */
        testInfo.fallbackSuppressed = true;
        cleanupAllShims();
        if (snapdomThrew) {
          throw new Error(
            `Glassworks test: ${adapter.name} threw (raw-engine mode): ` +
              testInfo.snapdomError
          );
        }
        return canvas;
      }
      testInfo.fallbackRan = true;
      testInfo.engine = "html2canvas";
    }
    if (!snapdomThrew) {
      console.warn(
        `Glassworks: ${adapter.name} returned an incomplete canvas (foreignObject clip) — switching to html2canvas.`
      );
    }
    if (typeof onEngineFallback === "function") onEngineFallback("html2canvas");
    const tFb0 = testInfo ? performance.now() : 0;
    try {
      return await captureViaHtml2canvas(target, { scale, ignore, engine: resolveEngine("html2canvas") });
    } finally {
      if (testInfo) testInfo.timings.fallbackMs = performance.now() - tFb0;
      cleanupAllShims();
    }
  }

  cleanupAllShims();
  return canvas;
}
