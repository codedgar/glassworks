# Real-page benchmark and Puppertino readiness

Measurements on real pages rather than synthetic fixtures: Glassworks' own site and demos, and the Puppertino 2.0 docs build. Companion to `tests/REPORT.md` (Phases 1–2). Same rules: every verdict comes from a number, images are artifacts only.

Run: 2026-09-29. Playwright 1.63.0 — Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6. Viewport 1280×800, DSF 1. Engines served locally: `@zumer/snapdom` 2.9.0 / 2.24.15 / 3.1.0, html2canvas 1.4.1.

## Headline results

1. **html2canvas cannot capture the Puppertino docs at all.** It throws `Attempting to parse an unsupported color function "color"` on `color-mix(in srgb, …)`, which Puppertino 2.0 uses for controls, switches and dialogs. All three retries fail, in all three browsers, so no capture is produced. SnapDOM renders the same pages correctly in every version.
2. **SnapDOM is not uniformly faster than html2canvas on real pages.** It wins clearly on Firefox and on the pages html2canvas can capture at all; it loses on Chromium for several pages. The "~4×" figure did not reproduce anywhere. Highest ratio measured: 7.1× (Firefox, demo-2); lowest: 0.21× (Chromium, demo-1, i.e. SnapDOM ~5× slower).
3. **3.1.0 is the fastest SnapDOM on the Puppertino docs**, by 2–2.4× against 2.9.0 on Chromium. One exception: WebKit on `docs/materials`, where 2.24.15 and 3.1.0 are ~2.5× *slower* than 2.9.0.
4. **Capture correctness on real pages is good.** Every fiducial marker passes on every page, version and browser (after harness fixes, below). Layer A on the static Puppertino pages is 0.83–3.49%, dropping to 0.00–1.03% once SnapDOM's 1 px border is accounted for.
5. **The html2canvas fallback never ran** on any real page, in any version or browser.

## 1. Method

### Pages

| Set | Pages | Lens targets |
|---|---|---|
| Glassworks (`gw:`) | `index.html`, `demos/demo-1…5`, `demos/comparison-scene` | each page's own `liquidGL()` call, with its real options (`resolution: 2`, its own selectors, `snapshot: ".main-content"` on demo-2/5) |
| Puppertino (`pup:`) | `index`, `docs/index`, `docs/materials`, `docs/colors`, `docs/typography`, `docs/foundations`, `docs/getting-started` | attached by the harness to the first matching `.landing-hero`, `.nav-group`, `article > section`, `.p-card` or `table` of at least 200×60 px |

`examples/index.html` was dropped: it is a 382-byte meta-refresh redirect stub, not a page.

### Vendoring (`tests/realpages/build.mjs`, rewrites in `tests/realpages/rewrites.json`)

Local copies with every external asset vendored; the tests themselves make no network requests, and any attempt is aborted and recorded. 26 files vendored, 143 rewrites logged. The classes of rewrite:

- CDN assets referenced by `src`/`href` (GSAP, ScrollTrigger, SplitText, Lenis, lil-gui, jQuery, jquery.ripples, Tailwind CDN runtime, Google Fonts CSS and its woff2 files) → `/tests/realpages/vendor/…`.
- Asset URLs built **inside inline scripts** (the pages' own snapdom loader) → vendored the same way.
- The pages' own capture-library loader (`document.write` of snapdom + `liquidGL.js`) → `/tests/realpages/noop.js`, so only the harness's copy loads and the engine/version is controlled. Each page's own `liquidGL()` call is left untouched.
- `preconnect` / `dns-prefetch` hints → removed (origins, not assets).
- Puppertino's GitHub Pages base path `/Puppertino/…` → `/tests/realpages/puppertino/…`. Its dist has no external URLs of its own.

### Variants

Layers A (fidelity), C (blank scan) and E (timing) run on the page as-is. Layer B runs on a second variant with six 48 px markers injected into the snapshot target at top, middle and bottom. The two are kept separate because injecting markers changes the page. Layer A is not run on the Glassworks pages: they animate (GSAP, Lenis), so there is no static ground truth to compare against.

## 2. Timing

Warm `captureMs`, median of 3 runs × 5 captures, measured one test at a time. "h2c/sd3.1" > 1 means SnapDOM 3.1.0 is faster than html2canvas.

### Chromium (headless, SwiftShader)

| Page | height | scale | sd 2.9.0 | sd 2.24.15 | sd 3.1.0 | html2canvas | h2c / sd3.1 |
|---|---|---|---|---|---|---|---|
| gw:demo-1 | 4000 | 2.00 | 586 | 717 | 722 | 154 | 0.21× |
| gw:demo-2 | 800 | 2.00 | 218 | 202 | 199 | 147 | 0.74× |
| gw:demo-5 | 2400 | 2.00 | 251 | 250 | 240 | 108 | 0.45× |
| gw:index | 6909 | 1.19 | 2605 | 1394 | 1273 | 1371 | 1.08× |
| pup:docs/colors | 6094 | 1.00 | 1232 | 1028 | 511 | **fails** | — |
| pup:docs/index | 800 | 1.00 | 770 | 590 | 240 | **fails** | — |
| pup:docs/materials | 8097 | 1.00 | 1551 | 1418 | 810 | **fails** | — |
| pup:index | 2006 | 1.00 | 106 | 92 | 101 | 73 | 0.72× |

### Firefox

| Page | sd 2.9.0 | sd 2.24.15 | sd 3.1.0 | html2canvas | h2c / sd3.1 |
|---|---|---|---|---|---|
| gw:demo-1 | 195 | 204 | 183 | 229 | 1.25× |
| gw:demo-2 | 35 | 27 | 29 | 206 | 7.10× |
| gw:demo-5 | 30 | 23 | 25 | 168 | 6.72× |
| gw:index | 637 | 508 | 401 | 206 | 0.51× |
| pup:docs/colors | 742 | 659 | 440 | **fails** | — |
| pup:docs/index | 454 | 397 | 263 | **fails** | — |
| pup:docs/materials | 873 | 939 | 586 | **fails** | — |
| pup:index | 60 | 51 | 59 | 95 | 1.61× |

### WebKit (Playwright build, not Safari)

| Page | sd 2.9.0 | sd 2.24.15 | sd 3.1.0 | html2canvas | h2c / sd3.1 |
|---|---|---|---|---|---|
| gw:demo-1 | 218 | 233 | 270 | 198 | 0.73× |
| gw:demo-2 | 112 | 87 | 132 | 203 | 1.54× |
| gw:demo-5 | 114 | 86 | 123 | 161 | 1.31× |
| gw:index | 767 | 696 | 773 | 260 | 0.34× |
| pup:docs/colors | 792 | 778 | 659 | **fails** | — |
| pup:docs/index | 590 | 545 | 478 | **fails** | — |
| pup:docs/materials | 1006 | **2343** | **2559** | **fails** | — |
| pup:index | 125 | 88 | 99 | 101 | 1.02× |

Notes:
- The Glassworks pages capture at `resolution: 2`, so their captures are 4× the pixel count of the Puppertino ones at the same page height. `gw:index` is clamped to 1.19 on Chromium/Firefox by `MAX_TEXTURE_SIZE` 8192, and runs at 2.00 on WebKit (16384).
- `pup:docs/materials` on WebKit is the one case where the newer SnapDOM versions are much slower than 2.9.0 (2343 / 2559 ms vs 1006 ms). That page is the backdrop-filter materials showcase.
- Chromium timings here are software-rendered (SwiftShader) and, per Phase 2, are sensitive to whether a screenshot was taken in the same page. These were measured with no prior screenshot.

## 3. html2canvas failure on Puppertino

| | |
|---|---|
| Error | `Attempting to parse an unsupported color function "color"` |
| Cause | `color-mix(in srgb, var(--p-control-accent) …)` in `_astro/colors…css`, `date-pickers…css`, `dialogs…css` |
| Affected | `docs/index`, `docs/colors`, `docs/materials` (and by inspection any page using Puppertino controls) — all three browsers |
| Behaviour | 3 capture attempts, all throw; `__glassworks.failed = true`; no texture is created |
| Not affected | `pup:index` (landing page), which does not render the controls that use `color-mix` |

## 4. Correctness on real pages

| Metric | Result |
|---|---|
| Layer B (markers), all pages × 3 versions × 3 browsers | **pass everywhere** — 126 records, 0 failures |
| Layer A, Puppertino static pages | 0.83–3.49%; at best shift (−1,−1): **0.00–1.03%** |
| Layer C | blank rows = the SnapDOM border only (2 rows at scale 1, 4 at scale 2); no interior blank regions on any page |
| html2canvas fallback | never ran; never suppressed in raw mode either |
| Capture errors | none with SnapDOM, in any version, on any page |

Version-specific detail: on `pup:docs/materials`, residual A after shift is 0.97–1.03% for 2.24.15 and 3.1.0 on Firefox and WebKit, versus 0.06–0.14% for 2.9.0. Chromium stays at 0.04–0.05% on all versions. Not investigated further.

## 5. `outerTransforms: false` (measured the same day)

Glassworks passes `outerTransforms: false` to every SnapDOM capture (`liquidGL.js:333-336`). That single option, and nothing else in the option set, produces the 1 px transparent border and the +1,+1 content offset reported in Phase 1. Measured on 11 fixtures × 3 versions × 3 browsers × 3 runs, with the option left at SnapDOM's default:

| | `outerTransforms: false` | SnapDOM default |
|---|---|---|
| Capture size at scale 1 | target + 2 px | exactly the target |
| Layer A | 0.43–1.93% | **0.00%** on every scale-1 fixture |
| Layer C blank edge rows | 1 per edge | 0 |
| Layer D (lens vs page) | 2.0–8.7% | 1.9–6.1%, still above the 1% threshold |

What the option protects against, by version (direct SnapDOM calls, 3 runs, all agreeing):

| Case | 2.9.0 default | 2.24.15 / 3.1.0 default | `false` (all versions) |
|---|---|---|---|
| `translateY(180%)` | capture **empty** | content present | content present, upright |
| `translate(40px, 20px)` | top-left 40×20 px **lost** | content present | content present, upright |
| `rotate(15deg)` | rotation baked in (342×271, transparent corners) | same | element upright |
| `scale(1.5)` | 450×300 | 450×300 | 450×300 — scale is **not** undone |

So the guard is only load-bearing on 2.9.0, and it costs exact alignment on every capture. Roughly a quarter to a third of the lens-region diff is the border; the rest is elsewhere in the renderer (the 5-sample average in the `frost == 0` path is the untested suspect).

## 6. Packaging notes for an external consumer

Measured integration behaviours, not design opinions:

- **No SnapDOM global = silent disappearance.** With `liquidGL.js` loaded and no `window.snapdom`, even with `engine: "html2canvas"` explicitly requested: `captureSnapshot()` returns early (`typeof snapdom === "undefined"`), no texture is created, `on.init` never fires, html2canvas is never fetched, and the lens element stays at `opacity: 0` — the element vanishes with nothing logged. Verified in Chromium.
- **The engine is locked at the first `liquidGL()` call** and the renderer is a page-level singleton (`window.__liquidGLRenderer__`), so a second component on the same page cannot choose a different engine.
- **Distribution shape:** one IIFE assigning `window.liquidGL`; `package.json` has `main`/`unpkg`/`jsdelivr` but no `exports`, no `module`, no types. Loading the file twice (as the vendored pages originally did) re-defines the global.
- **Weight (gzipped):** `liquidGL.js` 26 KB; SnapDOM 39 KB at 2.9.0, 84 KB at 3.1.0; html2canvas only if the fallback fires — which it never did here.
- **DPR:** the fixtures set `resolution` to the device pixel ratio; Glassworks' own pages hard-code `resolution: 2`, which on a tall page is what pushes the capture into `MAX_TEXTURE_SIZE` clamping (`gw:index` → scale 1.19 on Chromium/Firefox).
- **Fixed elements are excluded from captures** by design, so a lens inside a `position: fixed` sidebar or nav refracts the page behind the sidebar, not the sidebar.

## 7. Harness changes made during this run (disclosed)

Each of these was a harness defect found while running, fixed, and the affected combinations re-run:

1. Pages build their SnapDOM CDN URL inside an inline script, which the first vendoring pass missed. 144 timing tests recorded a blocked external request. Fixed by vendoring inline asset URLs; re-run.
2. Pages `document.write` their own snapdom + liquidGL, which re-defined `window.liquidGL` and discarded the harness's engine override, so h2c mode silently ran SnapDOM on those pages. Fixed by pointing the pages' loader at a no-op; re-run.
3. `geometry()` measured marker positions against `document.body`, wrong for pages using `snapshot: ".main-content"`. Fixed to use the renderer's actual `snapshotTarget`.
4. Markers were injected into `body` rather than the snapshot target, so they were genuinely absent from those pages' captures. Fixed; the host is switched to `position: relative` when static (recorded in `__fixture.markerHostAdjusted`).
5. Markers are injected after load, i.e. after the page's own first capture, so a recapture is forced before layer B is measured.

## 8. Layer-D isolation: what makes the lens differ from the page

2×2 matrix over 11 fixtures × 3 browsers × 3 runs on SnapDOM 2.9.0, with lens options `refraction: 0, bevelDepth: 0, frost: 0, specular: false, shadow: false`. "border fix" = `outerTransforms` at SnapDOM's default (no 1 px border); "single sample" = a test hook that takes one texture sample instead of averaging 5 taps in the `frost == 0` path.

Median lens-region diff:

| Fixture (all browsers unless noted) | current | border fix | single sample | both |
|---|---|---|---|---|
| baseline | 8.52–8.65% | 6.08–6.11% | 5.78–5.84% | **0.00%** |
| fixed-sticky | 8.04–8.17% | 5.94–5.98% | 5.95–6.04% | **0.00%** |
| webfont | 7.29–7.82% | 4.14–4.51% | 3.01–5.52% | 0.07–0.80% |
| long-page (Chromium/Firefox, scale 0.706) | 5.97–6.06% | 5.37% | 4.66–4.80% | 2.99–3.13% |
| long-page (WebKit, scale 1.0) | 4.53% | 3.28% | 4.73% | **0.00%** |
| pseudo-elements | 2.84–3.14% | 2.04–2.31% | 2.55–2.98% | 0.13–0.21% |
| absolute-overlay | 2.03–2.71% | 1.87–1.91% | 0.00–2.92% | **0.00%** |
| bg-variants | 0.95% | 0.94% | 2.14% | **0.00%** |
| clip / transforms / bg-image | 0.02–0.08% | 0.01–0.07% | 0.18–1.83% | **0.00%** |

Findings:

1. **The two causes together account for the whole diff.** Neither alone is sufficient — on baseline, the border fix gives 6.11% and the single sample 5.78%, but both together give 0.00%. Layer D passes in 84 of 99 cells with both applied (9 are `n/a`: no eligible lens).
2. **A third contributor is resolution scaling.** The only remaining failures are `long-page` on Chromium and Firefox (2.99–3.13%), where `MAX_TEXTURE_SIZE` 8192 forces the capture to scale 0.706. The same fixture on WebKit, captured at scale 1.0, is 0.00%. So the residual is the downscaled texture, not the shader or the border.
3. Sub-1% residuals remain on `webfont` (0.07–0.80%) and `pseudo-elements` (0.13–0.21%), i.e. text-heavy content; not isolated further.
4. The single-sample hook alone makes several fixtures *worse* (e.g. bg-image 0.02% → 1.83%), because the 5-tap average partly hides the 1 px misalignment. They have to be fixed together.

Layer A in the both-fixed mode is unchanged from the border-fix result: 45 of 99 pass, and every remaining failure is the short-page case where SnapDOM returns a viewport-tall canvas for a body shorter than the viewport.

## 9. Standalone device-check page

`tests/device-check.html` (641 KB, built by `tests/device-check/build.mjs`) inlines all three SnapDOM builds and Glassworks, makes no network requests, and can be opened directly in Safari on a Mac or iPhone. It reports user agent, DPR and WebGL `MAX_TEXTURE_SIZE`; runs the tall-capture threshold at 8,000 / 16,000 / 16,300 / 16,384 / 16,500 / 20,000 / 32,768 px per version; runs the fiducial and blank-region checks on a built-in fixture; counts hidden frames during three Glassworks captures; and offers a Copy JSON button. Verified in all three Playwright browsers (21 tall captures, 3 fixture checks, no page errors, no network).

Playwright WebKit results from that page, which pin the threshold to the decode cap:

| Requested height | 2.9.0 | 2.24.15 and 3.1.0 |
|---|---|---|
| 8,000 / 16,000 / 16,300 px | all content | all content |
| 16,384 px | 642×16,386, all content | 641×16,384, all content |
| 16,500 px | 642×16,502, all content | 637×16,384, **1 of 5 markers** |
| 20,000 px | 642×20,002, all content | 525×16,384, **no content** |
| 32,768 px | 642×32,770, all content | 320×16,384, **no content** |

Content survives up to exactly 16,384 px and is lost as soon as the cap forces a downscale.

### Real-device runs (2026-09-29)

`tests/device-check.html` was run by hand on four real browsers. All report `MAX_TEXTURE_SIZE` 16384.

| Device / browser | 2.9.0 | 2.24.15 | 3.1.0 |
|---|---|---|---|
| macOS Safari 26.3 (Apple GPU, DPR 2) | all content to 32,768 | 16,500 → 1/5; 20,000 → **none**; 32,768 → **none** | identical to 2.24.15 |
| iPhone (iOS 18.7, Safari 27.0, DPR 3) | all content to 32,768 | 16,500 → 1/5; 20,000 → **none**; 32,768 → **none** | identical to 2.24.15 |
| iPhone 13 Pro Max (iOS 18.7, Safari 27.0, DPR 3) | all content to 32,768 | 16,500 → 1/5; 20,000 → **none**; 32,768 → **none** | identical to 2.24.15 |
| macOS Chrome 154 (ANGLE / Metal, DPR 2) | all content to 32,768 | 16,500 and 20,000 → **all content** (downscaled); 32,768 → 3/8 | 20,000 → all content; 32,768 → 6/8 |

Findings:

1. **Playwright's WebKit matched real Safari exactly** for this behaviour, on both macOS and iOS, including the 1-of-5 partial at 16,500 px. The earlier WebKit results stand.
2. **The loss is WebKit-specific.** Real Chrome on the same machine downscales and keeps the content, which is what the SnapDOM maintainer described in liquidGL#11.
3. **Requesting exactly 16,384 px is safe on all four browsers**, including the `+2 px` border case: SnapDOM returns 641×16,384 with all five markers present.
4. Fiducial and blank-region checks pass on every device and version (4/4 markers, 2 blank rows = the border).
5. Capture time on real hardware is far below the headless figures: 9 ms (Chrome, M1 Pro), 65 ms (macOS Safari), 65–76 ms (iPhones), versus 70–120 ms headless.
6. Hidden frames during capture were observed on every device (Safari 20/225 and 16/249 and 24/234 frames; Chrome 3/466), consistent with claim C12b.

## 10. Changes applied after the measurements

Two library changes were made once the causes above were isolated, plus the packaging work. All are in `src/`; `scripts/liquidGL.js` is now the built UMD output.

| Change | Why | Measured effect |
|---|---|---|
| `outerTransforms: false` is no longer passed for the page snapshot (still passed for dynamic-element captures, and for a snapshot target that is itself transformed) | It padded every capture by 1 px per side and shifted content to (1,1) | Capture size now matches the target exactly; layer A 0.43–1.93% → **0.00%**; layer C blank edge rows 1 per edge → **0** |
| The `frost == 0` shader path samples once instead of averaging 5 texels | The average softened every lens against its source | Layer D 2.0–8.7% → **0.00%** on 7 of 9 fixtures |
| New `fallback: false` option | html2canvas cannot parse `color-mix()`, so a fallback on a Puppertino page fails the whole capture | Opt-out; default behaviour unchanged |
| Capture engine injected as an adapter; missing engine throws | A missing engine silently left every lens at `opacity: 0` | Covered by `tests/packaging.spec.mjs` (12 tests, 3 browsers) |

Layer results after the changes (SnapDOM 2.9.0, raw mode, all three browsers):

| Fixture | A before → after | D before → after |
|---|---|---|
| baseline | 1.42% → **0.00%** | 8.52% → **0.00%** |
| absolute-overlay | 0.72% → **0.00%** | 2.70% → **0.00%** |
| fixed-sticky | 0.64% → **0.00%** | 8.04% → **0.00%** |
| multi-lens-inflow | 0.90% → **0.00%** | n/a |
| transforms | 0.87% → **0.00%** | 0.04% → **0.00%** |
| bg-image | 1.92% → **0.00%** | 0.02% → **0.00%** |
| pseudo-elements | 1.71% → **0.00%** | 3.14% → 0.13–0.21% |
| webfont | 1.43% → **0.00%** | 7.29% → 0.07–0.80% |
| long-page (WebKit, scale 1) | 1.08% → **0.02%** | 4.53% → **0.00%** |
| long-page (Chromium/Firefox, scale 0.706) | 0.94% → 0.48% | 5.97% → 2.99–3.13% |

The long-page residual on Chromium and Firefox is the `MAX_TEXTURE_SIZE` downscale, unchanged by either fix: the same page on WebKit at scale 1.0 is 0.00%.

Real pages after the change: `pup:docs/index` layer A 0.83% → **0.00%**, blank rows 2 → 0. Pages using `registerDynamic` (`gw:index`, `demo-1`) capture with no errors.

Verification after the changes:
- Test-hook inertness: flag on vs flag off is pixel-identical in 27/27 runs (the spec no longer asserts equality with `main`, since the output intentionally changed; the diff against `main` is recorded as `vsMain`).
- Negative controls still detected, 9/9.
- 12 packaging tests pass in all three browsers.

## 11. Limitations

- Playwright's WebKit is not Safari; WebKit numbers are indicative.
- Chromium is headless with software WebGL. Absolute timings are not representative of a GPU-backed browser, and Phase 2 showed Chromium capture timing varies 3–5× with test context.
- DSF 1 only; no mobile emulation, no real devices.
- Layer A could not be measured on the Glassworks pages (they animate). Their coverage is B, C and E only.
- Lens targets on Puppertino were chosen by the harness by size and selector preference, not by how a real integration would place them.
- The Puppertino docs are a build snapshot from the repository at clone time, not the published site.
- `docs/materials` A-residual and WebKit slowdown on newer SnapDOM versions were observed, not investigated.
