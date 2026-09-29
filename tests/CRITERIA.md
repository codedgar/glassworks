# Harness pass/fail criteria

Written before the first measurement run. Values live in `tests/lib/criteria.mjs`.

| Layer | Measurement | PASS when |
|---|---|---|
| A. Capture fidelity | `pixelmatch` (threshold 0.1, anti-aliased pixels excluded) of the raw capture canvas vs Playwright's full-page screenshot of the snapshot target with lenses, `position: fixed` elements and `[data-liquid-ignore]` subtrees hidden. If the capture scale ≠ 1 (e.g. clamped by `MAX_TEXTURE_SIZE`), ground truth is area-resampled to `target × scale` first and the result is flagged `groundTruthResampled`. | capture size within ±2 px of `target × scale` **and** differing pixels ≤ 1 % of the compared area |
| B. Fiducials | For every marker point, expected image position = (marker rect − target rect) × scale, both from live `getBoundingClientRect()` (scroll offsets cancel; recorded). Median of a 5×5 block. | every point: each RGB channel within ±12 of the expected colour and alpha ≥ 240. The same check is run on ground truth; if ground truth fails a point, that point is `inconclusive` (the fixture, not the capture, is wrong). |
| C. Blank-region scan | Rows/columns whose every pixel is transparent (α ≤ 4) or black (r,g,b ≤ 4, α ≥ 250). Fixture backgrounds are never black or transparent. | 0 blank rows and 0 blank columns. `contentStopsAt` = first y from which all remaining rows are blank (null if none). |
| D. Shader identity | Lens options `refraction: 0, bevelDepth: 0, frost: 0, specular: false, shadow: false, tilt: false`. Viewport screenshot of the lens rect (inset 1 px) with the library initialised vs the same page with the library loaded but not initialised. Only lenses fully inside the initial viewport and not inside a fixed/ignored ancestor. | differing pixels ≤ 1 % |
| E. Timing | `captureMs` from `window.__glassworks` for the cold (on-load) capture and 5 sequential warm `captureSnapshot()` calls. | no verdict; median / min / max reported |

Aggregation over repeated runs of the same fixture × browser × mode × engine version × layer: all runs pass → **pass**; all fail → **fail**; mixed, or any run hit a harness error → **inconclusive**.

Harness integrity (these fail the Playwright run):
- negative controls must be detected (see `tests/negative-control.spec.mjs`);
- no request may leave `127.0.0.1` (all engines are served from `node_modules`);
- the library must obtain a WebGL2 context.
