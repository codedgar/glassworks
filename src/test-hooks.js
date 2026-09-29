/* Test-only debug hooks. Inert unless `window.GLASSWORKS_TEST` is truthy
 * before the library loads. Accepts `true` or an options object:
 *   { rawEngine, bgShim, snapdomOptions, singleSample,
 *     snapdomVersion, html2canvasVersion }
 * Results land on `window.__glassworks`. See tests/CRITERIA.md.
 */
export const TEST_ENABLED =
  typeof window !== "undefined" && !!window.GLASSWORKS_TEST;

export function testOpt(name) {
  const t = typeof window !== "undefined" && window.GLASSWORKS_TEST;
  return t && typeof t === "object" ? t[name] : undefined;
}

/** Version of the engine that produced a capture, for the test record. */
export function testEngineVersion(engine, adapter) {
  if (adapter && adapter.version) return adapter.version;
  if (engine === "snapdom") return testOpt("snapdomVersion") || null;
  return testOpt("html2canvasVersion") || null;
}

if (TEST_ENABLED) {
  window.__glassworks = {
    enabled: true,
    mode: testOpt("rawEngine") ? "raw" : "production",
    captureCount: 0,
    capturing: false,
    failed: false,
    canvas: null,
    engine: null,
    engineVersion: null,
    fallbackRan: false,
    fallbackReason: null,
    timings: null,
    history: [],
  };
}
