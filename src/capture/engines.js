/* Capture engines as injected adapters.
 *
 * An adapter is a plain object:
 *   {
 *     name: "snapdom",
 *     version: "3.1.0" | null,
 *     raw: <the underlying library>,
 *     capture(target, { scale, ignore, options }) -> Promise<HTMLCanvasElement>
 *   }
 *
 * Consumers can pass one directly (`glassworks({ engine: adapter })`), register
 * one by name (`glassworks.registerEngine("snapdom", adapter)`), or rely on the
 * globals a <script> tag leaves behind. If none of those produce an engine the
 * library throws instead of silently rendering nothing.
 */
import { testOpt, TEST_ENABLED } from "../test-hooks.js";

export class GlassworksEngineError extends Error {
  constructor(message) {
    super(message);
    this.name = "GlassworksEngineError";
  }
}

const registry = new Map();

/** Register a capture engine under a name (e.g. "snapdom", "html2canvas"). */
export function registerEngine(name, adapter) {
  if (!name || typeof name !== "string") throw new TypeError("registerEngine: name must be a string");
  if (!adapter || typeof adapter.capture !== "function") {
    throw new TypeError(`registerEngine("${name}"): adapter must have a capture(target, opts) function`);
  }
  registry.set(name, { name, version: null, ...adapter });
  return registry.get(name);
}

export function getRegisteredEngine(name) {
  return registry.get(name) || null;
}

/** Wrap the snapdom library in an adapter. */
export function createSnapdomEngine(snapdom, { version } = {}) {
  if (!snapdom || typeof snapdom.toCanvas !== "function") {
    throw new TypeError("createSnapdomEngine: expected the snapdom module (with toCanvas)");
  }
  return {
    name: "snapdom",
    version: version || snapdom.version || (TEST_ENABLED ? testOpt("snapdomVersion") : null) || null,
    raw: snapdom,
    capture(target, { scale, options } = {}) {
      /* `outerTransforms: false` is deliberately NOT a default. It makes
         snapdom pad the output by 1px per side and shift the content to
         (1,1), which puts every lens a pixel off its source. Callers that
         capture a transformed element (the dynamic-element path) opt in via
         `options`. Measured in tests/REPORT-BENCHMARK.md §5 and §8. */
      const opts = {
        scale: scale,
        dpr: 1,
        backgroundColor: "transparent",
        crossOrigin: "anonymous",
        embedFonts: true,
        ...(options || {}),
      };
      /* Test-only: a null value removes the key so snapdom's own default applies. */
      const override = TEST_ENABLED ? testOpt("snapdomOptions") : null;
      if (override && typeof override === "object") {
        for (const k in override) {
          if (override[k] === null) delete opts[k];
          else opts[k] = override[k];
        }
      }
      return snapdom.toCanvas(target, opts);
    },
  };
}

/** Wrap html2canvas in an adapter. The capture itself lives in html2canvas.js
 *  because it needs the clone-time ignore handling. */
export function createHtml2canvasEngine(html2canvas, { version } = {}) {
  if (typeof html2canvas !== "function") {
    throw new TypeError("createHtml2canvasEngine: expected the html2canvas function");
  }
  return {
    name: "html2canvas",
    version: version || (TEST_ENABLED ? testOpt("html2canvasVersion") : null) || null,
    raw: html2canvas,
    capture: null, // handled by captureViaHtml2canvas
  };
}

/**
 * Resolve the engine to use.
 * @param {string|object} requested adapter object, or a name
 * @returns {object|null} adapter, or null when the name is a lazy-loaded engine
 */
export function resolveEngine(requested) {
  if (requested && typeof requested === "object" && typeof requested.capture === "function") {
    return requested;
  }
  const name = typeof requested === "string" ? requested : "snapdom";
  const registered = registry.get(name);
  if (registered) return registered;

  if (name === "snapdom") {
    const g = typeof window !== "undefined" ? window.snapdom : undefined;
    if (g && typeof g.toCanvas === "function") return createSnapdomEngine(g);
    return null;
  }
  if (name === "html2canvas") {
    const g = typeof window !== "undefined" ? window.html2canvas : undefined;
    if (typeof g === "function") return createHtml2canvasEngine(g);
    return null; // ensureHtml2canvas() will lazy-load it
  }
  throw new GlassworksEngineError(
    `Glassworks: unknown capture engine "${name}". Register it first with glassworks.registerEngine("${name}", adapter).`
  );
}

/** Message used when nothing can capture; kept in one place so it stays actionable. */
export function noEngineMessage(name) {
  return (
    `Glassworks: no capture engine available (requested "${name}").\n` +
    "  • script tag:  <script src=\"https://cdn.jsdelivr.net/npm/@zumer/snapdom/dist/snapdom.js\"></script>\n" +
    "  • bundler:     import { snapdom } from '@zumer/snapdom';\n" +
    "                 glassworks({ engine: glassworks.createSnapdomEngine(snapdom) })\n" +
    "  • or register: glassworks.registerEngine('snapdom', glassworks.createSnapdomEngine(snapdom))\n" +
    "Without an engine there is nothing to refract, so the lens would stay invisible."
  );
}
