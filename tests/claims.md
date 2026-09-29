# Claims inventory (Phase 2)

Written before any Phase 2 test was run. Every verdict is `reproduced`, `not reproduced` or `inconclusive`, per claim × SnapDOM version × browser, from ≥ 3 runs. Runs that disagree → `inconclusive`. "Reproduced" always means *the claim as stated was observed to hold*.

Versions: **2.9.0** (pinned by Glassworks), **2.24.15** (cited in liquidGL#11), **3.1.0** (npm `latest` on 2026-09-21, published 2026-09-21T15:45Z; not a pre-release).

## Sources

| Key | Source |
|---|---|
| GW | `scripts/liquidGL.js` on `main` (`ff330f3`); line numbers refer to that commit |
| RM | `README.md` on `main` (`ff330f3`) |
| FAQ | naughtyduk/liquidGL `README.md` at `28e7c1a` (parent of `dff1d89`, the commit that removed the SnapDOM FAQ entry on 2026-09-07), line 254. The entry was added in `a0d5431` (v2.0.0). Found with `git log -S foreignObject -- README.md`. |
| #8 | https://github.com/naughtyduk/liquidGL/issues/8 (body + comments) |
| #11 | https://github.com/naughtyduk/liquidGL/issues/11 (body + comments) |

## Modes and methods

- **raw**: `GLASSWORKS_TEST.rawEngine = true` (no html2canvas fallback). The WebKit bg-image `<img>` shim is still active.
- **raw-noshim**: raw + `GLASSWORKS_TEST.bgShim = false` (test-only option; approved after Phase 1). Used wherever the shim would mask the claim.
- **production**: test flag on, fallback enabled; records whether/why html2canvas ran.
- **h2c**: library forced to `engine: "html2canvas"` (bg shim off), SnapDOM not involved. Used only for comparative claims.
- **lab**: direct `snapdom.toCanvas()` calls in `tests/fixtures/claims-lab.html`, with the library's own option set (`scale`, `dpr: 1`, `outerTransforms: false`, `backgroundColor: "transparent"`, `crossOrigin: "anonymous"`, `embedFonts: true`) unless a claim names other options. For element-level claims that the library cannot isolate.
- Fiducial check (B), blank scan (C), fidelity (A) and colour tolerance (±12 per channel, α ≥ 240, 5×5 median) are the Phase 1 layers (`tests/CRITERIA.md`). "Marker passes" = B check passes at the expected position.

## Claims

### C01. WebKit: CSS `background-image: url(...)` does not paint inside SnapDOM's foreignObject; `<img>` does
- **Source:** FAQ:254 ("CSS `background-image` does not paint inside `foreignObject` on WebKit"); GW:138-143, GW:451-456.
- **Fixture / measurement:** `bg-variants` in **raw-noshim**. B at the quadrant centres of: same-origin PNG, `data:` PNG, same-origin SVG, `data:` SVG (all `background-size: cover`, 240×240 = image size); and of an `<img>` with the same PNG (control).
- **Criterion (per browser):** reproduced if ≥ 1 url() background point fails while the `<img>` control points pass. Not reproduced if all url() points pass. Inconclusive if the `<img>` control fails. The claim names WebKit; Chromium/Firefox results are reported as-is.

### C02. The WebKit bg-image failure is specific to SVG images, not PNG
- **Source:** #11, comment by naughtyduk 2026-09-04 ("I think this was when SVG is used rather than PNG").
- **Fixture / measurement:** same run as C01.
- **Criterion:** reproduced if ≥ 1 SVG url() point fails and all PNG url() points pass. Not reproduced if SVG points all pass, or PNG points fail as well.

### C03. The same WebKit bg-image bug affects html2canvas
- **Source:** GW:140-141 ("same long-standing WebKit bug that affects html2canvas too"), GW:454-455.
- **Fixture / measurement:** `bg-variants` in **h2c** (shim off). B at the same points.
- **Criterion:** reproduced if ≥ 1 url() point fails on WebKit. Not a SnapDOM claim: SnapDOM version is irrelevant (reported once).

### C04. Chromium clips SnapDOM output beyond the first viewport on long pages; WebKit captures full height
- **Source:** FAQ:254 ("Chromium clips the output beyond the first viewport on long pages"); GW:281-289.
- **Fixture / measurement:** `long-page` (11,600 px) in **raw**. B at markers at y ≈ 16, 5,776, 11,552; C `contentStopsAt`.
- **Criterion:** reproduced if any marker below the first viewport (CSS y > 800) fails while the top markers pass, **or** content stops more than 2 CSS px (the 1 px border) before the target height. Not reproduced if all 9 markers pass and content does not stop early.

### C05. The Chromium clipping appears on pages longer than 11,600 px
- **Source:** #11, comment by naughtyduk 2026-09-04 ("our test page may have been much longer than this").
- **Fixture / measurement:** **lab**, element 640 px wide × 20,000 and 40,000 px, solid markers every 5,000 px and at the bottom; captured at the library's effective scale `min(1, MAX_TEXTURE_SIZE / H)` and at scale 1. Marker positions scaled by `canvas.height / H`.
- **Criterion:** reproduced if at either height/scale any marker below 800 CSS px fails while the top marker passes, or content stops early (> 2 image px before the bottom). Not reproduced if all markers pass in all four captures.

### C06. SnapDOM 2.24.x caps decoded output at 16,384 px per side; larger captures are downscaled, not clipped
- **Source:** #11 body ("SnapDOM 2.24.x does have a 16,384 px-per-side decode cap … Larger captures are downscaled, not clipped").
- **Fixture / measurement:** same lab captures as C05 at scale 1 (20,000 and 40,000 px tall). Record canvas size.
- **Criterion:** reproduced if canvas height ≤ 16,384 **and** every marker passes at its proportionally scaled position. Not reproduced if canvas height > 16,384 (no cap) or markers fail (clipped). Reported for all versions; the claim names 2.24.x.

### C07. Only in-viewport content is rasterised; off-screen elements come back empty
- **Source:** FAQ:254 ("only in-viewport content is rasterised, so off-screen dynamic elements need re-capturing"); GW:28-32, GW:1629-1631, GW:1944-1946; RM:187.
- **Fixture / measurement:** **lab**, `snapdom.toCanvas(el)` on elements placed ~11,000 px below the top with the page at scroll 0: a solid `<div>`, a `data:` PNG `<img>`, an inline `<svg>` with a solid rect, a `<canvas>` filled with a solid colour. Control: same element after `scrollIntoView()`. Measurement: centre colour (B) and C blank ratio.
- **Criterion (per element type):** reproduced if the off-screen capture fails B (or is ≥ 99 % blank rows) while the in-view control passes. Not reproduced if the off-screen capture passes. Inconclusive if the control fails.

### C08. Off-screen failures occur for `<svg>` and "other elements" specifically
- **Source:** #11, comment by naughtyduk 2026-09-04 ("may have tested `<svg>` and other elements with varying success").
- **Fixture / measurement:** C07's `<svg>` and `<canvas>` cases.
- **Criterion:** reproduced if the off-screen `<svg>` or `<canvas>` case is reproduced under C07. Not reproduced otherwise.

### C09. liquidGL#11 repro: an 11,600 px element captures at full height with expected pixels
- **Source:** #11 body (repro script; claims for 11,600 px height, "data: PNG `<img>` and a solid block more than 11,000 px below the top", WebKit gradient + `data:` PNG tile, "tile is pixel-exact and the gradient is within one colour level").
- **Fixture / measurement:** **lab**, the repro reproduced verbatim except the script source (local `node_modules`), options `{ scale: 1, dpr: 1 }` as in the repro. Samples at x = 320, y = 7410 (gradient, expect 255,224,130,255), 10000 (tile, 0,170,170,255), 11300 (`<img>`, 255,0,255,255), 11500 (bottom, 51,51,238,255); canvas height vs `offsetHeight`.
- **Criterion:** reproduced if canvas height = `offsetHeight`, tile and `<img>` and bottom samples are exact (Δ = 0 per channel), and the gradient sample is within Δ ≤ 1. Not reproduced otherwise (reporting which sample differs). The 1-px-exact samples follow the issue's own wording.

### C10. `position: absolute` descendants whose containing block is the viewport drop out of SnapDOM's rasterisation
- **Source:** GW:10-13; RM:75, RM:258, RM:303.
- **Fixture / measurement:** `absolute-overlay` in **raw**. B on `abs-a`, `abs-b` (no positioned ancestor) and control `abs-rel` (positioned ancestor).
- **Criterion:** reproduced if `abs-a` or `abs-b` fails while `abs-rel` passes. Not reproduced if all pass. Inconclusive if `abs-rel` fails.

### C11. Glassworks detects absolute descendants and lazy-loads html2canvas (only for those) on such pages
- **Source:** GW:14-17, GW:99-102; RM:18, RM:75, RM:258, RM:303.
- **Fixture / measurement:** `absolute-overlay` in **production**: whether any capture ran the fallback, and whether a request for the html2canvas script was made.
- **Criterion:** reproduced if html2canvas is requested or the fallback runs. Not reproduced if neither happens in any run. (A claim about Glassworks behaviour, reported per SnapDOM version because the fallback depends on the engine's output.)

### C12. SnapDOM has no `onclone`-style hook, so Glassworks mutates the live DOM (visibility: hidden) during capture, and lenses / fixed UI can flicker
- **Source:** GW:25-27, GW:271-279 ("snapdom has no `onclone` hook").
- **Two measurements:**
  - **C12a (hook exists?)** **lab**: capture a block with a marker child, passing a plugin whose `afterClone(ctx)` sets `visibility: hidden` on the clone of the marker (found by a data attribute in `ctx.clone`). Record whether the hook was invoked, whether the marker is absent from the capture (sample shows the parent's colour), and whether the live marker's inline style changed during capture (MutationObserver).
    **Criterion:** the "no hook" claim is reproduced if the hook is not invoked or has no effect on the capture. Not reproduced if the hook runs, the marker is absent from the capture and the live DOM had 0 style mutations.
  - **C12b (live flicker)** every fixture in **production** and **raw**: a `requestAnimationFrame` sampler watches every lens element and every `position: fixed` element and counts frames in which any has computed `visibility: hidden`, during the on-load capture and 5 warm captures.
    **Criterion:** reproduced if ≥ 1 frame is observed with a watched element hidden. Not reproduced if 0 hidden frames in every run.

### C13. Glassworks uses "the snapdom equivalent" of `onclone` to hide in the clone, so there is no flicker
- **Source:** RM:301 ("uses html2canvas's `onclone` hook (and the snapdom equivalent) to apply `visibility: hidden` to the clone instead … no flicker").
- **Fixture / measurement:** C12b's sampler.
- **Criterion:** reproduced if 0 hidden frames in every run of every fixture. Not reproduced if ≥ 1 hidden frame is observed.

### C14. SnapDOM's `filter` option inflates the capture bounding box by ~1.6×
- **Source:** GW:273-276 ("snapdom v2.9's `filter` option … inflates the canvas bounding box ~1.6x").
- **Fixture / measurement:** **lab**: `snapdom.toCanvas(document.body)` of `claims-lab.html`'s filter section twice, without and with `filter: el => !el.hasAttribute('data-filter-out')` (library option set otherwise). Ratio of canvas width and height; B check that the filtered element is absent.
- **Criterion:** reproduced if the width or height ratio (with / without) ≥ 1.3. Not reproduced if both ratios are within 1 ± 0.05. Inconclusive otherwise.

### C15. SnapDOM returns a canvas a few px larger than `scale × source` dimensions
- **Source:** GW:1063-1067.
- **Fixture / measurement:** Layer A capture size vs `round(target × scale)`, all fixtures, **raw**.
- **Criterion:** reproduced if the capture exceeds the expected size by ≥ 1 px in either dimension on ≥ 1 fixture. Not reproduced if all captures match exactly.

### C16. Without `outerTransforms: false`, a transformed capture root renders shifted and the capture comes back empty
- **Source:** GW:333-336.
- **Fixture / measurement:** **lab**: element with `transform: translateY(180%)` (the GSAP `yPercent: 180` case) captured with the library options except `outerTransforms` left at SnapDOM's default, and again with `outerTransforms: false` (control). C blank ratio + B at the element centre.
- **Criterion:** reproduced if the default capture is ≥ 90 % blank rows or fails B while the control passes. Not reproduced if the default capture passes B. Inconclusive if the control fails.

### C17. SnapDOM renders CSS gradients (SVG paint-server path) correctly, including on WebKit
- **Source:** GW:159-161.
- **Fixture / measurement:** `bg-variants` in **raw-noshim**: B at the centres of the bands of a hard-stop `linear-gradient`.
- **Criterion:** reproduced if every gradient point passes. Not reproduced if any fails.

### C18. SnapDOM does not honour the host's `overflow` / mask clipping the way html2canvas does
- **Source:** GW:967-971.
- **Fixture / measurement:** `clip` fixture: markers partly outside an `overflow: hidden` parent, a `clip-path: inset()` parent and a `mask-image` parent. B at points inside the clip (expect marker colour) and outside it (expect the page background). **raw** and **h2c**.
- **Criterion:** reproduced if in **raw** ≥ 1 "outside" point shows the marker colour (not clipped) where the same point in **h2c** is clipped. Not reproduced if SnapDOM clips every case html2canvas clips. Inconclusive if ground truth fails an outside point.

### C19. The live-DOM hide window is ~50–200 ms on Chromium for a viewport-sized capture
- **Source:** GW:277-278.
- **Fixture / measurement:** `baseline` (840 px tall) in **raw**, Chromium: hide window = `hideMs + bgShimMs + snapdomMs` from the test hook, cold and warm (timing pass).
- **Criterion:** reproduced if the warm median lies in [50, 200] ms. Not reproduced otherwise. Headless Chromium here renders WebGL via SwiftShader; indicative only.

### C20. SnapDOM captures ~4× faster than html2canvas (~80 ms vs ~300 ms on a typical page)
- **Source:** RM:17 ("snapdom's `<foreignObject>` pipeline does in ~80ms what html2canvas does in ~300ms"); FAQ:254 ("faster at capture in isolation").
- **Fixture / measurement:** timing pass, warm `captureMs` median, `baseline` and `long-page`, **raw** vs **h2c**, per browser and version.
- **Criterion:** "faster" (FAQ) reproduced if ratio h2c / raw > 1. "~4×" (RM) reproduced if ratio ∈ [3, 5]. Not reproduced otherwise. Absolute ms values are reported, not judged.

### C21. When a page must fall back to html2canvas, the hybrid is slower than html2canvas alone
- **Source:** #8, comment by naughtyduk 2026-07-29 ("for any sites which have to fall back to html2canvas, this actually reduces performance due to duplicate libs").
- **Fixture / measurement:** any fixture where **production** ran the fallback: that capture's `captureMs` vs the **h2c** median for the same fixture/browser.
- **Criterion:** reproduced if the fallback capture is slower than the h2c median. Cannot be tested for a combination where the fallback never runs.

## Found but not tested

| Claim | Source | Why not tested |
|---|---|---|
| SnapDOM "introduces too many edge cases to reliably replace html2canvas in broad use" | #8 (naughtyduk, 2026-07-29) | No specific case stated; not measurable as written. |
| Safari: double capture is "the most likely cause of the 'text disappears for a beat after load' behaviour" | GW:602-609 | Speculative cause about the library's scheduling on Safari; no measurable claim about SnapDOM output. Hidden frames are covered by C12b. |
| html2canvas `ignoreElements` → `display: none` collapses in-flow lenses (drift) | #8 body; RM:301 | A claim about html2canvas/liquidGL, not SnapDOM. Glassworks' SnapDOM path is covered by `multi-lens-inflow` B markers in the fixture matrix. |
| html2canvas + mobile browsers bug motivating the fixed-element ignore | RM:281 | About html2canvas on mobile; not reproducible in desktop Playwright. |
| Safari unstable when a lens exceeds ~50 % of the viewport | RM:274 | Renderer stability, not capture. |
| If html2canvas fails to lazy-load, the shim returns the partial SnapDOM result | GW:33-35 | Library error handling, not a SnapDOM capture claim. |
| SnapDOM 3.0 `html-in-canvas` engine (Chrome-only, behind a flag) | #11 body | Experimental/closed beta; excluded by the spec (no pre-release builds). |
