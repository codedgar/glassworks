// Pass/fail criteria. Fixed BEFORE any measurement was run; see
// tests/CRITERIA.md for the rationale. Do not tune these to results.
export const CRITERIA = Object.freeze({
  fidelity: Object.freeze({
    pixelmatchThreshold: 0.1, // pixelmatch per-pixel YIQ threshold (its default)
    includeAA: false,         // pixels pixelmatch classifies as anti-aliasing are not counted
    maxDiffRatio: 0.01,       // PASS if <= 1% of expected-area pixels differ
    dimTolerancePx: 2,        // capture size must be within ±2px of target × scale
  }),
  fiducial: Object.freeze({
    sampleSize: 5,            // median of a 5×5 block at the expected centre
    channelTolerance: 12,     // PASS if every RGB channel within ±12 of expected
    minAlpha: 240,            // ...and alpha >= 240
  }),
  blank: Object.freeze({
    alphaMax: 4,              // pixel counts as transparent if alpha <= 4
    rgbMax: 4,                // pixel counts as black if r,g,b <= 4 and alpha >= opaqueMin
    opaqueMin: 250,
    // PASS if zero rows and zero columns consist entirely of transparent/black pixels.
  }),
  shaderIdentity: Object.freeze({
    pixelmatchThreshold: 0.1,
    includeAA: false,
    maxDiffRatio: 0.01,       // PASS if <= 1% of lens-region pixels differ
  }),
  timing: Object.freeze({ warmRuns: 5 }),
  // Across repeated runs of the same (fixture, browser, mode, version, layer):
  // all pass -> pass; all fail -> fail; mixed, or any run errored -> inconclusive.
});
