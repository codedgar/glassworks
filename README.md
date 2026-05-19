# Glassworks

<a href="https://github.com/codedgar/glassworks"><img src="/assets/glassworks-promo.gif" alt="Glassworks" style="width: 100%"/></a>

**Liquid glass for the web.** Glassworks turns any positioned element into a refracted, glossy glass pane rendered in WebGL — fast, lightweight, and rebuilt on [snapdom](https://github.com/zumerlab/snapdom) for ~4× faster captures than the original pipeline.

<a href="/demos/demo-1.html"><strong>DEMO 1</strong></a> | <a href="/demos/demo-2.html"><strong>DEMO 2</strong></a> | <a href="/demos/demo-3.html"><strong>DEMO 3</strong></a> | <a href="/demos/demo-4.html"><strong>DEMO 4</strong></a> | <a href="/demos/demo-5.html"><strong>DEMO 5</strong></a>

> The library exposes one global, `liquidGL`, so existing code keeps working. Same call, same options. The project, brand, and ongoing maintenance are Glassworks.

---

## Why Glassworks

|                          |                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **~4× faster captures**  | snapdom's `<foreignObject>` pipeline does in ~80ms what html2canvas does in ~300ms on a typical page. Captures stop being the bottleneck.                                                                                                             |
| **~50KB by default**     | html2canvas only loads if your page actually needs it (when an absolute overlay is detected on the snapshot target). Most pages stay at ~50KB; the legacy stack would have shipped ~250KB up front.                                                   |
| **No drift on long pages** | Patched the upstream bug where in-flow lenses far down the page rendered against a collapsed snapshot. Lenses now stay perfectly aligned, however many you stack.                                                                                  |
| **Broader browser story**| Tested and tuned on Chrome, Safari, Firefox, and Edge across desktop, tablet, and mobile. Includes a frosted CSS fallback for environments where WebGL isn't available.                                                                               |
| **Drop-in API**          | Same `liquidGL({ ... })` call, same options. If you want the html2canvas-only pipeline, pass `engine: "html2canvas"` or load `liquidGL-legacy.js`. The drift fix is applied either way.                                                              |

---

## Features

| Feature                                | Supported | Feature                  | Supported |
| :------------------------------------- | :-------: | :----------------------- | :-------: |
| Real-time refraction (static content)  |    ✅     | Magnification control    |    ✅     |
| Real-time refraction (video)           |    ✅     | Dynamic element support  |    ✅     |
| Real-time refraction (text animations) |    ✅     | GSAP-ready animations    |    ✅     |
| Real-time refraction (CSS animations)  |    ❌     | Lightweight & performant |    ✅     |
| Adjustable bevel                       |    ✅     | Seamless scroll sync     |    ✅     |
| Frosted glass effect                   |    ✅     | Auto-resize handling     |    ✅     |
| Dynamic shadows                        |    ✅     | Auto video refraction    |    ✅     |
| Specular highlights                    |    ✅     | Animate lenses           |    ✅     |
| Interactive tilt effect                |    ✅     | `on.init` callback       |    ✅     |

---

## Install

Glassworks ships two builds. Most projects want the default.

### npm

```bash
npm i @codedgar/glassworks
```

Glassworks is a browser library that attaches a global, so reference the build with a `<script>` tag once it's in `node_modules`:

```html
<script src="node_modules/@codedgar/glassworks/scripts/liquidGL.js" defer></script>
```

Or load it straight from a CDN — no install required:

```html
<script src="https://cdn.jsdelivr.net/npm/@codedgar/glassworks" defer></script>
```

### Default — `liquidGL.js`

snapdom is the capture backend. html2canvas is lazy-loaded only when the page actually needs it.

```html
<!-- snapdom: required by default -->
<script src="https://cdn.jsdelivr.net/npm/@zumer/snapdom/dist/snapdom.js" defer></script>

<!-- Glassworks -->
<script src="/scripts/liquidGL.js" defer></script>
```

If the snapshot target contains a `position: absolute` descendant whose containing block is the page viewport (a common pattern in hero overlays and reveal sections), Glassworks lazy-loads `html2canvas` from cdnjs and composites that element on top of the snapdom base canvas. Pages without that pattern never trigger the fetch.

To self-host or pin a version, set the URL on `window` before the library loads:

```html
<script>
  window.LIQUIDGL_HTML2CANVAS_URL = "/vendor/html2canvas.min.js";
</script>
```

If `window.html2canvas` is already defined when Glassworks needs it, the lazy-load is skipped.

You can also force the html2canvas pipeline at runtime without swapping files:

```js
liquidGL({
  target: ".liquidGL",
  engine: "html2canvas", // default is "snapdom"
});
```

### Legacy — `liquidGL-legacy.js`

The pure html2canvas pipeline (with the drift fix). Use this if you'd rather pre-load html2canvas and skip the snapdom code path entirely.

```html
<!-- html2canvas: required for the legacy build -->
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"
  defer
></script>

<!-- Glassworks: legacy build -->
<script src="/scripts/liquidGL-legacy.js" defer></script>
```

Both builds expose the same global and accept the same options.

---

## Quick start

Set up your HTML. You'll have a `target` element that becomes the glass pane and a child element for content (content sits on top, isn't refracted into the lens).

```html
<body>
  <!-- Target (glassified) -->
  <div class="liquidGL">
    <!-- Content -->
    <div class="content">
      <img src="/example.svg" alt="Alt Text" />
      <p>This text content will appear on top of the glass.</p>
    </div>
  </div>
</body>
```

> Give the `target` a high `z-index` so it sits over your page content. Anything with a higher `z-index` than the target is excluded from the lens (e.g. a modal video player you don't want staining the glass).

Then initialise:

```html
<script>
  document.addEventListener("DOMContentLoaded", () => {
    const glass = liquidGL({
      snapshot: "body",     // area used for refraction; <body> is the default
      target: ".liquidGL",  // CSS selector for the element(s) to glassify
      resolution: 2.0,      // snapshot quality
      refraction: 0.01,     // base refraction strength (0–1)
      bevelDepth: 0.08,     // edge bevel intensity (0–1)
      bevelWidth: 0.15,     // bevel width as a proportion of the element (0–1)
      frost: 0,             // subtle blur radius in px (0 = crystal clear)
      shadow: true,         // soft drop-shadow under the pane
      specular: true,       // animated light highlights (slightly more GPU)
      reveal: "fade",       // reveal animation
      tilt: false,          // tilt on hover
      tiltFactor: 5,        // if tilt is enabled, how much
      magnify: 1,           // magnification of lens content
      on: {
        init(instance) {
          // Fires once Glassworks has taken its snapshot and rendered the
          // first frame. Right place to chain reveal animations — content
          // is captured before you hide it from the user.
          console.log("Glassworks ready!", instance);
        },
      },
    });
  });
</script>
```

---

## Dynamic content

Glassworks refracts dynamic content like animations in real time. To make this work, register any dynamic elements that will intersect with your glass pane. That tells the renderer to monitor them and update the texture when they change.

> Videos are auto-detected and don't need to be registered.

Register after initialising `liquidGL()` and before calling `liquidGL.syncWith()` (if you use it). You can register by CSS selector or by passing an array of DOM elements.

```js
const glass = liquidGL({ target: ".liquidGL" /* ... */ });

// By CSS selector
liquidGL.registerDynamic(".my-animated-element");

// Multiple elements (e.g. from GSAP SplitText)
const split = SplitText.create(".my-text", { type: "lines" });
liquidGL.registerDynamic(split.lines);
```

> **snapdom note:** dynamic elements that aren't currently painted in the viewport (e.g. lines waiting for a ScrollTrigger far below the fold) are captured via an `IntersectionObserver`-driven recapture path so they populate as they enter view. First paint inside the lens may lag by one capture frame on a fast scroll. The legacy build doesn't have this constraint.

---

## Sync with smooth scrolling (optional)

`syncWith()` auto-detects [Lenis](https://github.com/darkroomengineering/lenis) or [Locomotive Scroll](https://github.com/locomotivemtl/locomotive-scroll) and handles render-loop synchronisation for you.

```html
<script>
  document.addEventListener("DOMContentLoaded", () => {
    const glass = liquidGL({ target: ".liquidGL" /* ... */ });

    const { lenis, locomotiveScroll } = liquidGL.syncWith();
  });
</script>
```

> Load the scroll library scripts (Lenis, GSAP, etc.) before your main script. `syncWith()` must be called after `liquidGL()`.

---

## Options

| Option       | Type     | Default       | Description                                                                                                                                                          |
| ------------ | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`     | string   | `'.liquidGL'` | **Required.** CSS selector for the element(s) to glassify.                                                                                                           |
| `snapshot`   | string   | `'body'`      | CSS selector for the element to snapshot.                                                                                                                            |
| `resolution` | number   | `2.0`         | Resolution of the background snapshot (clamped 0.1–3.0). Higher is sharper but uses more memory.                                                                     |
| `refraction` | number   | `0.01`        | Base refraction offset applied across the pane (0–1).                                                                                                                |
| `bevelDepth` | number   | `0.08`        | Additional refraction on the edge to simulate depth (0–1).                                                                                                           |
| `bevelWidth` | number   | `0.15`        | Width of the bevel zone as a fraction of the shortest side (0–1).                                                                                                    |
| `frost`      | number   | `0`           | Blur radius in pixels for a frosted look. `0` is clear.                                                                                                              |
| `shadow`     | boolean  | `true`        | Toggles a subtle drop-shadow under the pane.                                                                                                                         |
| `specular`   | boolean  | `true`        | Enables animated specular highlights that move with time.                                                                                                            |
| `reveal`     | string   | `'fade'`      | Reveal animation. `'none'`: renders immediately. `'fade'`: smoothly fades in.                                                                                        |
| `tilt`       | boolean  | `false`       | Enables 3D tilt interaction on cursor movement.                                                                                                                      |
| `tiltFactor` | number   | `5`           | Depth of the tilt in degrees (0–25 recommended).                                                                                                                     |
| `magnify`    | number   | `1`           | Magnification factor of the lens (clamped 0.001–3.0). `1` is no magnification.                                                                                       |
| `engine`     | string   | `'snapdom'`   | Capture backend. `'snapdom'` (default) uses snapdom + lazy html2canvas hybrid. `'html2canvas'` forces the html2canvas-only path. Locked at the first `liquidGL()` call. |
| `on.init`    | function | `-`           | Callback that runs once the first render completes. Receives the lens instance.                                                                                      |

> `target` is required; everything else is optional.

---

## Presets

Ready-made configurations you can copy-paste. Tweak to taste.

| Name        | Settings                                                                                               | Purpose                                          |
| ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Default** | `{ refraction: 0, bevelDepth: 0.052, bevelWidth: 0.211, frost: 2, shadow: true, specular: true }`      | Balanced default used in the demo.               |
| **Alien**   | `{ refraction: 0.073, bevelDepth: 0.2, bevelWidth: 0.156, frost: 2, shadow: true, specular: false }`   | Strong refraction & deep bevel for sci-fi looks. |
| **Pulse**   | `{ refraction: 0.03, bevelDepth: 0, bevelWidth: 0.273, frost: 0, shadow: false, specular: false }`     | Flat pane with wide bevel. Good for pulsing UI.  |
| **Frost**   | `{ refraction: 0, bevelDepth: 0.035, bevelWidth: 0.119, frost: 0.9, shadow: true, specular: true }`    | Softly diffused, privacy-glass style.            |
| **Edge**    | `{ refraction: 0.047, bevelDepth: 0.136, bevelWidth: 0.076, frost: 2, shadow: true, specular: false }` | Thin bevel, bright rim highlights.               |

---

## FAQ

| Question                                                              | Answer                                                                                                                                                                                                                                                                                                                            |
| :-------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is there a resize handler?                                            | Yes, debounced to 250ms.                                                                                                                                                                                                                                                                                                          |
| Does the effect work on mobile?                                       | Yes. The library handles all three WebGL versions and falls back to a frosted CSS `backdrop-filter` on older devices.                                                                                                                                                                                                             |
| I have a preloader — how should I initialise?                         | Add `data-liquid-ignore` to your preloader's top-level container to exclude it from the snapshot. Then call `liquidGL()` inside a `DOMContentLoaded` listener as you normally would.                                                                                                                                              |
| What's the right way to use Glassworks with page animations?          | Say you have a preloader, above-the-fold intro animations, and scroll animations. The order is: 1) set `data-liquid-ignore` on the preloader, 2) animate the preloader and set up initial states, 3) call `liquidGL()`, 4) optionally, in `on.init()`, run any post-snapshot scripts (e.g. animate the target element).            |
| Can I use Glassworks on multiple elements?                            | Yes. Any element matching `target` gets glassified. **All lenses must share the same `z-index`** because of shared-canvas optimisations. If you specify different `z-index` values, the highest one wins.                                                                                                                          |
| Will I exceed WebGL contexts or hit other perf walls?                 | No. The library uses a shared canvas for all instances. Tested up to 30 elements on one page without crashes or perf problems.                                                                                                                                                                                                    |
| Are there animation limitations?                                      | Rotation and scale are expensive. `shadow`, `specular`, and `tilt` should be used carefully on pages with many instances or complex animations — they can clog the render pipeline.                                                                                                                                                |
| Why does my page lazy-load html2canvas on the first capture?          | The snapdom build detected a `position: absolute` descendant on your snapshot target, which is a layout pattern snapdom's foreignObject pipeline can't render correctly. Glassworks fetches html2canvas at that moment and composites the absolute element on top of the snapdom base. To avoid the runtime fetch, pre-load html2canvas yourself or use the legacy build. |

---

## Browser support

Glassworks runs on every WebGL-enabled browser on desktop, tablet, and mobile.

| Browser        | Supported |
| :------------- | :-------: |
| Google Chrome  |    Yes    |
| Safari         |    Yes    |
| Firefox        |    Yes    |
| Microsoft Edge |    Yes    |

> [!NOTE]
> Performance varies between browsers. Safari can be unstable when the liquid element(s) take more than ~50% of viewport width or height. Practical issues are rare — test on your target devices.

---

## Notes

- For dynamic content to refract in real time, register it with `liquidGL.registerDynamic()`. Set initial animation states **before** calling `liquidGL()` so they're captured correctly.
- The library ignores `fixed`-position elements. This is a safety net for a known bug between html2canvas and mobile browsers that can prevent the snapshot from running. It shouldn't get in your way.
- Multiple instances must share the same `z-index`. Different values fall back to the highest. The shared canvas prevents WebGL context blow-ups — there's no work-around for that.
- For better performance on complex pages, snapshot a smaller, specific element instead of the whole page (e.g. `snapshot: '.my-background'`). Less texture memory, faster captures.
- The initial capture is async. Call `liquidGL()` inside a `DOMContentLoaded` or `load` handler so content is available to the snapshot.
- Very long documents can exceed GPU texture limits and cause memory or performance issues. Segment long pages or lower `resolution`.
- `shadow` and `tilt` create new stacking layers behind the `target` (`shadow` at `z-index - 2`, the `tilt` helper canvas at `z-index - 1`). Leave room in your `z-index` values so they don't get clipped.
- Like any WebGL effect, image content inside the `target` needs permissive `Access-Control-Allow-Origin` headers to avoid CORS issues.

**Exclude elements** — set `data-liquid-ignore` on the parent container of whatever you want to keep out of the refraction.

**Content visibility** — use `z-index: 3;` on the content inside your target so it sits on top of the lens. Pair with `mix-blend-mode: difference;` for better legibility.

**Border-radius** — Glassworks inherits the `border-radius` of the `target` automatically. If you animate it (e.g. on scroll), the bevel animates in real time to stay in sync.

---

## Under the hood

A couple of things worth knowing if you're curious how the snapdom rewrite hangs together.

**The drift fix.** Upstream passes lens elements to `html2canvas` via the `ignoreElements` callback, which the library implements by setting `display: none` on those elements in its cloned DOM. That collapses real layout space, so every section below a lens shifts up in the snapshot. The lens math reads positions from the live DOM, so live coords stop matching snapshot coords, and every lens refracts the wrong region — the offset compounds the further down the page each lens sits. Glassworks tags lens elements with a data attribute and uses html2canvas's `onclone` hook (and the snapdom equivalent) to apply `visibility: hidden` to the clone instead. Layout is preserved, no drift, no flicker.

**The hybrid capture.** snapdom's `<foreignObject>` pipeline can't render `position: absolute` descendants of the snapshot target the way html2canvas does. For those, Glassworks lazy-loads html2canvas only when an absolute descendant is detected and composites that element on top of the snapdom base canvas. Pages without that pattern never trigger the html2canvas fetch and stay at ~50KB.

---

## Credits & licence

Glassworks is a fork of [`liquidGL`](https://github.com/naughtyduk/liquidGL) by NaughtyDuk©. The original library and its WebGL renderer were authored by NaughtyDuk. Glassworks adds the snapdom default capture pipeline, the html2canvas hybrid fallback, the long-page drift fix, browser-compat tuning, and ongoing maintenance.

MIT © NaughtyDuk (original) · MIT © Codedgar (fork)
