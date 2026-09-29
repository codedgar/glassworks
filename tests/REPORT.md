# Glassworks capture verification report

Measurements of SnapDOM capture behaviour in Glassworks, and of the capture limitations attributed to SnapDOM in this repository and in naughtyduk/liquidGL. Every verdict comes from a numeric measurement (pixel diff ratio, sampled colour, row scan, timing); saved images are review artifacts only.

- **Phase 1:** a verification harness, with a baseline on SnapDOM 2.9.0 (the version Glassworks uses).
- **Phase 2:** 21 claims tested against SnapDOM 2.9.0, 2.24.15 and 3.1.0 in Chromium, Firefox and WebKit, 3 runs per cell.

Pass/fail criteria were written before the runs they govern: `tests/CRITERIA.md` (Phase 1) and `tests/claims.md` (Phase 2).

## Summary

- **None of the SnapDOM capture limitations claimed in the sources reproduced as stated**, in any tested version or browser. This covers WebKit `background-image`, Chromium clipping past the first viewport, viewport-only rasterisation, absolute overlays dropping out, the missing `onclone` hook, and `filter` inflating the capture.
- **Reproduced:**
  - SnapDOM returns canvases a few px larger than `scale × source` (C15).
  - Glassworks hides lenses and its own WebGL canvas in the live page during every capture (C12b).
  - Only in 2.9.0, a transformed capture root comes back empty unless `outerTransforms: false` is set (C16).
  - The liquidGL#11 repro passes in every version and browser (C09).
- **Found outside the claims:** in WebKit, SnapDOM 2.24.15 and 3.1.0 return captures containing **only the root background** once the requested output reaches about 16,384 px tall. In Chromium and Firefox, capped outputs keep their content but are letterboxed. 2.9.0 has no cap.
- **The html2canvas fallback never ran** in 297 production-mode runs.
- **With the test flag off, the library is unchanged:** its output was pixel-identical to the unmodified library in every equivalence run.

## Setup

| | |
|---|---|
| Browsers | Playwright 1.63.0: Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 |
| Viewport / DSF | 1280×800, device scale factor 1 |
| WebGL | WebGL2 obtained in all three browsers. Chromium runs headless with SwiftShader (`MAX_TEXTURE_SIZE` 8192; Firefox also 8192, WebKit 16384) |
| Engines (all served locally from `node_modules`) | `@zumer/snapdom` 2.9.0, 2.24.15, 3.1.0 (npm `latest` on 2026-09-21, published 2026-09-21T15:45Z, not a pre-release); html2canvas 1.4.1 |
| Network | Every request outside 127.0.0.1 is aborted and recorded; none occurred |
| Unmodified library for comparison | `ff330f3` (`main`) |

Run commands:
- `npm run test:glass`: Phase 1 layers. 261 tests, about 32 min.
- `npm run test:glass:phase2`: Phase 2 claims. A 1,107-test verdict pass on 3 workers, then a 72-test timing pass run one at a time; about 42 min.

Output goes to `test-results/report.md`, `test-results/report.json` and `test-results/artifacts/`.

---

# Phase 1: harness and baseline

## What was built

- **Library hooks (`scripts/liquidGL.js`):**
  - Everything is inert unless `window.GLASSWORKS_TEST` is set before the script loads.
  - When on, `window.__glassworks` exposes the most recent raw capture canvas (before any shader processing), the engine and engine version, whether the html2canvas fallback ran and why, timings (total, engine call, hide walk, bg shim, fallback), and a per-capture history.
  - `rawEngine: true` disables the fallback: it records what would have triggered it and returns SnapDOM's own result.
  - `bgShim: false` (Phase 2) skips the WebKit `background-image` `<img>` shim.
- **SnapDOM build selection:** done by the fixture loader (`?snapdom=<version>` loads `node_modules/snapdom-<version>`). The library reads the global `snapdom`, so it needed no change for this.
- **Harness (`tests/`):**
  - `fixtures/`: 11 fixture pages plus the loader `harness.js`; `claims-lab.html` for direct SnapDOM calls.
  - `lib/`: the measurement layers, page helpers, criteria, marker-location diagnostic and records.
  - Specs: `fixtures`, `claims-lab`, `negative-control`, `equivalence`.
  - A static server (`server.mjs`), the report generator (`report.mjs`) and the claims evaluator (`claims-eval.mjs`).
- **Measurement layers:**
  - **A. Capture fidelity:** `pixelmatch` of the raw capture against Playwright's own screenshot of the snapshot target, with lenses, fixed elements and `[data-liquid-ignore]` hidden.
  - **B. Fiducial markers:** coloured squares sampled at the position their live bounding rect predicts.
  - **C. Blank-region scan:** fully transparent or black rows and columns, and where content stops.
  - **D. Shader identity:** the lens region with `refraction: 0`, `bevelDepth: 0`, `frost: 0`, `specular: false`, `shadow: false`, against the same page without the library initialised.
  - **E. Timing:** the on-load capture plus 5 warm recaptures.
- **Fixtures:** `baseline`, `long-page` (11,600 px), `bg-image`, `absolute-overlay`, `pseudo-elements`, `fixed-sticky`, `multi-lens-inflow`, `webfont` (local Pacifico), `transforms`. Phase 2 adds `bg-variants` and `clip`.

## SnapDOM version used by Glassworks: 2.9.0

- **Pinned to `@zumer/snapdom@2.9.0` on jsdelivr:** `index.html:719`, `demos/demo-1.html:460`, `demo-2.html:674`, `demo-3.html:438`, `demo-4.html:404`, `demo-5.html:292`, `comparison-scene.html:171`.
- **Unpinned `@zumer/snapdom/dist/snapdom.js`** (resolves to 3.1.0 as of 2026-09-21): the install snippets in `README.md:69` and `index.html:590`.
- `package.json` declares no SnapDOM dependency, and npm marks 2.9.0 as deprecated.

## Library behaviour with the test flag off: unchanged

- **Code:** the only removed line is the `snapToCanvas` signature, which gained an optional `testInfo` parameter. Every added line sits behind a `TEST_ENABLED` or `testInfo` check.
- **Measured:** 9 fixtures × 3 browsers × 3 runs, with Phase 1 and Phase 2 hooks each checked. The snapshot texture and the WebGL output were pixel-identical to `ff330f3` (0 px differ), and a control comparing `ff330f3` against itself also gave 0 px. `window.__glassworks` was absent every time.

## Negative controls: all detected (3 browsers × 3 runs)

| Control | Result |
|---|---|
| Positive: ground truth vs itself (A, B, C) | pass, as expected |
| A: capture shifted 24 px | fail (10.8%; real capture shifted: 11.1%) |
| B: markers expected at +200 / +7 px | fail on 6 of 6 |
| B: capture shifted 24 px | fail on 6 of 6 |
| C: bottom 30% cleared plus a 10-row black band | `contentStopsAt` = the cleared row (588); 10 black rows found |
| D: lens with refraction 0.05 / bevelDepth 0.2 | fail (15.6%) |
| Ground-truth tiling (long page) | tiled = single-shot on Firefox and WebKit (0 px); all markers found on Chromium |

## Baseline results (SnapDOM 2.9.0; raw-engine and production modes gave identical numbers)

| Fixture | A diff (Chromium / Firefox / WebKit) | A diff after best shift | B markers | C blank edges (top, bottom, left, right) | D lens diff |
|---|---|---|---|---|---|
| baseline | 1.42 / 1.42 / 1.37% FAIL | 0.00% at (−1,−1) | PASS 6/6 | 1,1,1,1 FAIL | 8.5–8.7% FAIL |
| long-page | 0.94 / 1.02 / 1.08% | 0.69 / 0.51 / 0.21% | PASS 9/9 | Chromium 0; Firefox 1,0,1,0; WebKit 1,1,1,1 | 4.5–6.1% FAIL |
| bg-image | 1.9% FAIL (size) | 0.00% | PASS 9/9 | bottom 321 FAIL | 0.02% PASS |
| absolute-overlay | 0.51–0.72% PASS | 0.00–0.15% | PASS 5/5 | 1,1,1,1 FAIL | 2.0–2.7% FAIL |
| pseudo-elements | 1.6–1.7% FAIL (size) | 0.00% | PASS 6/6 | bottom 329 FAIL | 2.8–3.1% FAIL |
| fixed-sticky | 0.61–0.64% PASS | 0.00% | PASS 5/5 | 1,1,1,1 FAIL | 8.0–8.2% FAIL |
| multi-lens-inflow | 0.86–0.90% PASS | 0.00% | PASS 6/6 | 1,1,1,1 FAIL | n/a |
| webfont | 1.4–1.9% FAIL (size) | 0.00% | PASS 3/3 | bottom 358 FAIL | 7.3–7.8% FAIL |
| transforms | 0.81–0.87% FAIL (size) | 0.00% | PASS 6/6 | bottom 121 FAIL | 0.04–0.07% PASS |

What drives the A and C failures:
- **1 px border.** SnapDOM returns a canvas 2 px larger in each dimension, with a 1 px transparent border, so content sits at +1,+1. Shifted back by (−1,−1), the diff is ≤ 0.2% on every fixture captured at scale 1.
- **Short pages.** When the body is shorter than the 800 px viewport, the capture is still 802 px tall; for example, `bg-image` has a 480 px body and an 802 px capture. That fails the size check and adds blank rows at the bottom.

Other baseline facts:
- **Long page scale:** Chromium and Firefox capture it at scale 0.706 (`MAX_TEXTURE_SIZE` 8192), and ground truth is resampled to match. WebKit captures at scale 1.
- **Layer D:** when frost is 0, the shader always averages 5 samples 1 texel apart (`liquidGL.js`, the `refrCol` block). How much of the D diff that explains, versus the 1 px offset, was not isolated.
- **Captures per load:** usually 2. The library's ResizeObserver schedules a second capture about 250 ms after init.

## Phase 1 deviations from the spec

1. **Tall-page ground truth is stitched** from 2,000 px full-page clip tiles, because Chromium can't take an 11,600 px screenshot in one shot. This was validated against single-shot screenshots on Firefox and WebKit.
2. **Ground truth comes from a second page load** with the library loaded but not initialised, which keeps library recaptures and bg shims out of the screenshots.
3. **Fixture settings:** `resolution` is set to the device pixel ratio (1), `reveal: "none"`, `shadow: false`. DSF 2 was not run.
4. **Metrics beyond the spec:** best-fit shift for A, per-edge blank counts for C, and a timing breakdown. Measurement verdicts don't fail the Playwright run; only integrity checks do.
5. **Code facts found along the way:**
   - The header comment and README describe an absolute-descendant detection path that composites with html2canvas. No such code exists; the fallback triggers only when SnapDOM throws or when the row sample finds an incomplete canvas.
   - `captureSnapshot` returns early when SnapDOM isn't loaded, so the "SnapDOM undefined → html2canvas" branch can't be reached from it.

---

# Phase 2: claims × SnapDOM version × browser

## Sources

| Key | Source |
|---|---|
| GW | `scripts/liquidGL.js` at `ff330f3` |
| RM | `README.md` at `ff330f3` |
| FAQ | naughtyduk/liquidGL `README.md:254` at `28e7c1a`. The entry was added in `a0d5431` (v2.0.0) and removed in `dff1d89` on 2026-09-07, four days after #11 was opened. Located with `git log -S foreignObject -- README.md`. |
| #8 | https://github.com/naughtyduk/liquidGL/issues/8 |
| #11 | https://github.com/naughtyduk/liquidGL/issues/11 |

The full claim text, measurements and pre-registered criteria are in `tests/claims.md`.

## Modes

| Mode | What it does |
|---|---|
| **raw** | Test flag on, html2canvas fallback disabled |
| **raw-noshim** | raw, plus the WebKit bg `<img>` shim off |
| **production** | Fallback enabled |
| **h2c** | Library forced to `engine: "html2canvas"` |
| **lab** | Direct `snapdom.toCanvas()` calls with Glassworks' option set |

## Verdicts

R = reproduced (the claim was observed to hold), N = not reproduced, I = inconclusive, U = untestable. Each cell is Chromium / Firefox / WebKit, from 3 runs.

| Claim | 2.9.0 | 2.24.15 | 3.1.0 | Key numbers |
|---|---|---|---|---|
| C01 WebKit drops CSS `background-image` url(); `<img>` paints (FAQ:254, GW:138-143) | N N N | N N N | N N N | 16/16 url() points pass (PNG and SVG, file and data URI), bg shim off; `<img>` control passes |
| C02 The failure is specific to SVG images (#11 comment) | N N N | N N N | N N N | 0/8 SVG and 0/8 PNG points fail |
| C03 The same bug affects html2canvas (GW:140-141; engine-independent) | N N I | – | – | Chromium/Firefox 16/16 pass; WebKit: the html2canvas canvas is tainted and its pixels can't be read (`SecurityError`) |
| C04 Chromium clips beyond the first viewport on long pages (FAQ:254, GW:281-289) | N N N | N N N | N N N | 11,600 px page: all 6 below-viewport markers pass; content doesn't stop early |
| C05 Clipping appears on longer pages (#11 comment) | N N N | I I I | I I I | See "Tall captures" below |
| C06 2.24.x caps output at 16,384 px: downscaled, not clipped (#11 body) | N N N | I I N | N N N | 2.9.0: no cap; 3.1.0 Chromium/Firefox: cap is 32,767; WebKit capped outputs have no content |
| C07 Only in-viewport content is rasterised (FAQ:254, GW:28-32, GW:1629-1631, GW:1944-1946, RM:187) | N N N | N N N | N N N | `div`, `img`, `svg`, `canvas` 11,000 px below the fold: centre pixel exactly 255,0,255 in all |
| C08 Off-screen failures occur for `<svg>` and other elements (#11 comment) | N N N | N N N | N N N | Follows from C07 |
| C09 liquidGL#11 repro | R R R | R R R | R R R | Height 11,600 = `offsetHeight`; gradient, tile, `<img>` and bottom samples all Δ0 |
| C10 `position: absolute` overlays with a viewport containing block drop out (GW:10-13, RM:75/258/303) | N N N | N N N | N N N | Both overlay markers and the positioned control pass |
| C11 Glassworks detects absolute descendants and lazy-loads html2canvas (GW:14-17, RM:18/75/258/303) | N N N | N N N | N N N | Fallback never ran; html2canvas never requested |
| C12a SnapDOM has no `onclone`-style hook (GW:25-27, GW:271-279) | N N N | N N N | N N N | An `afterClone` plugin ran, hid the element in the clone only; 0 live-page style changes |
| C12b Lenses / fixed UI hidden in the live page during capture | R R R | R R R | R R R | 22/22 fixtures had hidden frames; per run: Chromium 134–297, Firefox 72–291, WebKit 805–1,246 hidden frames |
| C13 Glassworks hides in the clone, so there's no flicker (RM:301) | N N N | N N N | N N N | Same measurement as C12b |
| C14 `filter` inflates the capture box ~1.6× (GW:273-276) | N N N | N N N | N N N | Size ratio 1.00 × 1.00; the filtered element is absent |
| C15 Canvas a few px larger than `scale × source` (GW:1063-1067) | R R R | R R R | R R R | +2 px wide on every fixture; up to +359 px tall when the body is shorter than the viewport |
| C16 A transformed root captures empty without `outerTransforms: false` (GW:333-336) | R R R | N N N | N N N | 2.9.0: 200/200 rows blank; later versions: centre pixel correct |
| C17 Gradients render correctly, including on WebKit (GW:159-161) | R R R | R R R | R R R | 0/4 gradient points fail |
| C18 SnapDOM doesn't honour overflow / clip-path / mask clipping the way html2canvas does (GW:967-971) | N N N | N N N | N N N | SnapDOM clipped all 3 cases. html2canvas did **not** clip the clip-path or mask cases |
| C19 Live-page hide window is ~50–200 ms on Chromium (GW:277-278) | N N R | N N R | N N R | Warm median: Chromium 28–46 ms, Firefox 27–33 ms, WebKit 72–106 ms (the claim concerns Chromium) |
| C20 SnapDOM faster than html2canvas (FAQ:254), baseline fixture | I R N | N R N | R R N | Speed ratio (html2canvas ÷ SnapDOM): Chromium 0.86–1.15×, Firefox 2.3–2.9×, WebKit 0.66–1.0× |
| C20 SnapDOM ~4× faster than html2canvas (RM:17), baseline and long-page | N all | N all | N all | Highest ratio measured: 2.89× (Firefox, baseline, 3.1.0) |
| C20 SnapDOM faster than html2canvas, long-page fixture | N R I | N R R | N R R | Chromium 0.57–0.96×, Firefox 1.5–2.5×, WebKit 0.85–1.33× |
| C21 When the fallback runs, the hybrid is slower than html2canvas alone (#8 comment) | U | U | U | The fallback never ran |

Inconclusive cells: C20 2.9.0 Chromium and long-page 2.9.0 WebKit have runs that disagree; C03 WebKit's canvas is unreadable; C05/C06 are explained below.

## Tall captures (C05 / C06)

The pre-registered check samples each marker where proportional downscaling says it should land. On capped outputs, that check can't tell misplaced content from missing content. A diagnostic added after the run (`tests/lib/locate.mjs`) searches each marker's colour down the capture's centre column. It adds facts only; no failure was turned into a pass.

| Output | Chromium / Firefox | WebKit |
|---|---|---|
| 2.9.0 | No cap: 642×20,002 and 642×40,002, all markers in place (offsets ≤ 1 px) | Same |
| 2.24.15 | Capped at 16,384 px. All markers present, but content is letterboxed (~30 blank rows top and bottom; offsets up to ±31 px) | Once the requested height is ≥ ~16,384 px (at scale 1 and at the scale Glassworks would request): **no marker colour anywhere in the column**. The output is only the root background |
| 3.1.0 | Capped at 32,767 px (40,000 px case → 525×32,767), letterboxed the same way; all markers present | Same loss of content as 2.24.15 |

## Claims not tested

| Claim | Source | Reason |
|---|---|---|
| SnapDOM "introduces too many edge cases" | #8 (naughtyduk, 2026-07-29) | No specific case is named |
| Safari double capture makes text "disappear for a beat" | GW:602-609 | A guess at a cause, not a measurable claim; hidden frames are covered by C12b |
| html2canvas `display: none` lens drift | #8 body, RM:301 | html2canvas/liquidGL behaviour, not SnapDOM; the SnapDOM path is covered by `multi-lens-inflow` markers |
| html2canvas mobile bug behind the fixed-element ignore | RM:281 | Mobile html2canvas behaviour, which desktop Playwright can't reproduce |
| Safari unstable with lenses > 50% of the viewport | RM:274 | Renderer stability, not capture |
| Partial SnapDOM result returned when html2canvas fails to load | GW:33-35 | Library error handling |
| SnapDOM 3.0 `html-in-canvas` engine | #11 body | Pre-release; excluded |
| C21 | #8 | The fallback never ran |

## Fallback

The html2canvas fallback **never ran** in 297 production-mode runs (11 fixtures × 3 versions × 3 browsers × 3 runs). Raw-engine mode never recorded a case where the fallback *would* have run. No case exists where the fallback was needed.

## Timing

These are medians in ms from the timing pass, run one test at a time (Chromium / Firefox / WebKit). Warm = 5 sequential captures per run, pooled over 3 runs; cold = the on-load capture.

| | 2.9.0 | 2.24.15 | 3.1.0 | html2canvas |
|---|---|---|---|---|
| baseline, warm | 72 / 31 / 107 | 74 / 28 / 81 | 63 / 28 / 90 | 64 / 78 / 72 |
| baseline, cold | 194 / 60 / 269 | 145 / 57 / 84 | 169 / 61 / 96 | 99 / 103 / 98 |
| long-page, warm | 123 / 57 / 120 | 99 / 46 / 83 | 74 / 39 / 103 | 70 / 90 / 109 |
| long-page, cold | 196 / 106 / 238 | 226 / 100 / 105 | 204 / 97 / 114 | 105 / 115 / 126 |

## Limitations of the method

- **WebKit results are indicative, not definitive.** Playwright's WebKit build is not Safari.
- **Headless Chromium renders WebGL with SwiftShader.** With `MAX_TEXTURE_SIZE` 8,192 (Firefox is 8,192 here too), Glassworks captures the 11,600 px page at scale 0.706. Hardware GPUs differ.
- **Chromium timing depends on context.** Warm captures took 290–420 ms when a Playwright screenshot had been taken in the same page, against 63–74 ms measured alone. The cause was not isolated. C19 and C20 use only the isolated timing-pass numbers; Firefox and WebKit timings were stable across contexts.
- **The flicker sampler reads computed `visibility` once per animation frame.** It doesn't prove the hidden state reached the screen.
- **Fiducials have limited resolution.** A 5×5 median inside a 48 px marker can't see offsets of a few pixels (layer A covers those). At scales below ~0.1, markers shrink to 3–4 px and are undersampled.
- **Changes made after the criteria were registered:**
  - An evaluator bug was fixed: C05 had counted a top-marker failure as "not reproduced", which `claims.md` doesn't allow, so it's now inconclusive.
  - The C05/C06 marker-location diagnostic was added.
- **The fixtures are synthetic.** The liquidGL authors say their original test pages were different and possibly much longer (#11), and those pages aren't available.
- **Coverage:** desktop viewport and DSF 1 only; no mobile or DSF 2.
- **Fixture design affects some verdicts.** On short fixtures the capture is 802 px tall regardless of body height, and that drives several Phase 1 A/C failures.
