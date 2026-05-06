# Glassworks by Codedgar

<a href="https://liquidgl.naughtyduk.com"><img src="/assets/liquidGlass-promo.gif" alt="Glassworks" style="width: 100%"/></a>

Ultra-light glassmorphism for the web. Glassworks turns any positioned element into a refracted, glossy glass pane rendered in WebGL.

> Glassworks is a maintained fork of [`liquidGL`](https://github.com/naughtyduk/liquidGL) by NaughtyDuk©. Public API is unchanged, so it's a drop-in upgrade. Original credit and licence at the bottom.

<a href="/demos/demo-1.html"><strong>DEMO 1</strong></a> | <a href="/demos/demo-2.html"><strong>DEMO 2</strong></a> | <a href="/demos/demo-3.html"><strong>DEMO 3</strong></a> | <a href="/demos/demo-4.html"><strong>DEMO 4</strong></a> | <a href="/demos/demo-5.html"><strong>DEMO 5</strong></a>

---

## What's new

### Drift bug fix on long pages with multiple in-flow lenses

The upstream library passes lens elements to `html2canvas` via the `ignoreElements` callback. html2canvas implements that by setting `display: none` on those elements in its cloned DOM, which collapses real layout space. Every section below a lens shifts up in the snapshot. The lens math reads positions from the live DOM, so live coords stop matching snapshot coords, and every lens refracts the wrong region. The offset compounds the further down the page each lens sits.

Glassworks tags lens elements with a data attribute and uses html2canvas's `onclone` hook to apply `visibility: hidden` to the clone instead. Layout is preserved, no drift, no flicker. The same fix is mirrored in the snapdom build.

### Snapdom default capture pipeline (~4× faster) with html2canvas hybrid fallback

Captures used to be the most expensive thing the library did. html2canvas reimplements DOM rendering and that's slow. Glassworks ships [snapdom](https://github.com/zumerlab/snapdom) as the default capture backend. On a typical page, captures drop from ~300ms to ~80ms in production.

snapdom's `<foreignObject>` pipeline can't render `position: absolute` descendants of the snapshot target the way html2canvas does. For those, Glassworks lazy-loads html2canvas only when an absolute descendant is detected and composites that element on top of the snapdom base canvas. Pages without the absolute pattern never trigger the html2canvas fetch and stay at ~50KB instead of ~250KB.

### Drop-in API; legacy build still available

Existing code keeps working. Same `liquidGL({ ... })` call, same options, same behaviour. If you want the html2canvas-only pipeline, you have two options: pass `engine: "html2canvas"` to the same call, or load `liquidGL-legacy.js` instead of `liquidGL.js`. Either way, the drift fix is applied.

---

## Key features

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

## Prerequisites

Glassworks ships two builds. The default (`liquidGL.js`) uses snapdom for the base capture and lazy-loads html2canvas only when needed. The legacy build (`liquidGL-legacy.js`) is the pure html2canvas pipeline with the drift fix, kept for parity with upstream and for environments where you want a smaller bundle.

Both expose the same global `liquidGL` function and accept the same options.

### Default build (`liquidGL.js`)

```html
<!-- snapdom: required by default -->
<script src="https://cdn.jsdelivr.net/npm/@zumer/snapdom/dist/snapdom.js" defer></script>

<!-- Glassworks -->
<script src="/scripts/liquidGL.js" defer></script>
```

If the snapshot target contains a `position: absolute` descendant whose containing block is the page viewport (a pretty common pattern in hero overlays, "reveal" sections, that kind of thing), Glassworks lazy-loads `html2canvas` from cdnjs automatically. To override the URL, set it on `window` before the library loads:

```html
<script>
  // Optional: self-host html2canvas or pin a specific version
  window.LIQUIDGL_HTML2CANVAS_URL = "/vendor/html2canvas.min.js";
</script>
```

If `window.html2canvas` is already defined when Glassworks needs it, the lazy-load is skipped.

You can also force the html2canvas pipeline at runtime with the `engine` option (no need to swap files):

```js
liquidGL({
  target: ".liquidGL",
  engine: "html2canvas", // default is "snapdom"
});
```

With `engine: "html2canvas"`, the snapdom path is bypassed entirely and html2canvas is lazy-loaded for the first capture. Same drift fix is applied either way.

### Legacy build (`liquidGL-legacy.js`)

For environments where you want to pre-load html2canvas and skip the snapdom code path entirely (smaller bundle, no `engine` option needed):

```html
<!-- html2canvas: required for the legacy build -->
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"
  defer
></script>

<!-- Glassworks: legacy build -->
<script src="/scripts/liquidGL-legacy.js" defer></script>
```

---

## Quick start

Set up your HTML structure first. You'll have a `target` element that receives the glass effect, and a child element for your content (which is excluded from the glass effect).

```html
<!-- Example HTML structure -->
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

> Make sure your `target` element has a high `z-index` so it sits over your page content. Anything with a higher `z-index` than the `target` is excluded from the lens (e.g. a modal video player you don't want to stain the lens).

Then initialise the library with the selector for your target element.

```html
<script>
  document.addEventListener("DOMContentLoaded", () => {
    const glassEffect = liquidGL({
      snapshot: "body", // The area used for refraction. <body> is recommended and the default
      target: ".liquidGL", // CSS selector for the element(s) to glassify
      resolution: 2.0, // Quality of the snapshot
      refraction: 0.01, // Base refraction strength (0–1)
      bevelDepth: 0.08, // Intensity of the edge bevel (0–1)
      bevelWidth: 0.15, // Width of the bevel as a proportion of the element (0–1)
      frost: 0, // Subtle blur radius in px. 0 = crystal clear
      shadow: true, // Adds a soft drop-shadow under the pane
      specular: true, // Animated light highlights (slightly more GPU)
      reveal: "fade", // Reveal animation
      tilt: false, // Whether tilt on hover is enabled
      tiltFactor: 5, // If tilt is enabled, how much tilt
      magnify: 1, // Magnification of lens content
      on: {
        init(instance) {
          // The `init` callback fires once Glassworks has taken its snapshot
          // and rendered the first frame. It's the right place to hide or
          // prepare elements for reveal animations (e.g. with GSAP, ScrollTrigger)
          // since the content is visible to the snapshot before you hide it
          // from the user.
          console.log("Glassworks ready!", instance);
        },
      },
    });
  });
</script>
```

---

## Dynamic rendering

Glassworks can refract dynamic content like animations in real-time. To make this work, you have to register any dynamic elements that will intersect with your glass pane. That tells the renderer to monitor them and update the texture when they change.

> **Note:** videos are auto-detected and don't need to be registered.

Register dynamic elements after initialising `liquidGL()` but before calling `liquidGL.syncWith()` (if used). You can register elements using a CSS selector string or by passing an array of DOM elements.

```javascript
// After initialising Glassworks
const glassEffect = liquidGL({
  target: ".liquidGL",
  // ... other options
});

// Register an element by CSS selector
liquidGL.registerDynamic(".my-animated-element");

// Register multiple elements (e.g., from a GSAP SplitText animation)
const mySplitText = SplitText.create(".my-text", { type: "lines" });
liquidGL.registerDynamic(mySplitText.lines); // Pass the array of line elements
```

> **snapdom-build note:** dynamic elements that aren't currently painted in the viewport (e.g. lines waiting for a ScrollTrigger animation far below the fold) are captured via an `IntersectionObserver`-driven recapture path so they populate as they enter view. First paint inside the lens may lag by one capture frame on a fast scroll. The legacy html2canvas build doesn't have this constraint.

---

## Sync with smooth scrolling libraries (optional)

Glassworks includes a `syncWith()` helper that integrates with Lenis and Locomotive Scroll. It handles render-loop synchronisation for you.

> Call `liquidGL.syncWith()` after initialising `liquidGL`.

```html
<script>
  document.addEventListener("DOMContentLoaded", () => {
    const glassEffect = liquidGL({
      target: ".liquidGL",
      // ... other options
    });

    // Auto-detects Lenis or Locomotive Scroll and returns their instances if found
    const { lenis, locomotiveScroll } = liquidGL.syncWith();
  });
</script>
```

> Make sure to include the scroll library scripts (Lenis, GSAP, etc.) before your main script. `syncWith()` must be called after `liquidGL()`.

---

## Parameters

| Option       | Type     | Default       | Description                                                                                      |
| ------------ | -------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `target`     | string   | `'.liquidGL'` | **Required.** CSS selector for the element(s) to glassify.                                       |
| `snapshot`   | string   | `'body'`      | CSS selector for the element to snapshot.                                                        |
| `resolution` | number   | `2.0`         | Resolution of the background snapshot (clamped 0.1–3.0). Higher is sharper but uses more memory. |
| `refraction` | number   | `0.01`        | Base refraction offset applied across the pane (0–1).                                            |
| `bevelDepth` | number   | `0.08`        | Additional refraction on the edge to simulate depth (0–1).                                       |
| `bevelWidth` | number   | `0.15`        | Width of the bevel zone as a fraction of the shortest side (0–1).                                |
| `frost`      | number   | `0`           | Blur radius in pixels for a frosted look. `0` is clear.                                          |
| `shadow`     | boolean  | `true`        | Toggles a subtle drop-shadow under the pane.                                                     |
| `specular`   | boolean  | `true`        | Enables animated specular highlights that move with time.                                        |
| `reveal`     | string   | `'fade'`      | Reveal animation. `'none'`: renders immediately. `'fade'`: smoothly fades in.                    |
| `tilt`       | boolean  | `false`       | Enables 3D tilt interaction on cursor movement.                                                  |
| `tiltFactor` | number   | `5`           | Depth of the tilt in degrees (0–25 recommended).                                                 |
| `magnify`    | number   | `1`           | Magnification factor of the lens (clamped 0.001–3.0). `1` is no magnification.                   |
| `engine`     | string   | `'snapdom'`   | Capture backend. `'snapdom'` (default) uses snapdom + lazy html2canvas hybrid. `'html2canvas'` forces the html2canvas-only path. Locked at first `liquidGL()` call. |
| `on.init`    | function | `-`           | Callback that runs once the first render completes. Receives the lens instance.                  |

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

| Question                                                                | Answer                                                                                                                                                                                                                                                                                                                            |
| :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is there a resize handler?                                              | Yes, resize is handled in the library and debounced to 250ms for performance.                                                                                                                                                                                                                                                     |
| Does the effect work on mobile?                                         | Yes. The library handles all 3 versions of WebGL and falls back to a frosted CSS `backdrop-filter` for older devices.                                                                                                                                                                                                             |
| I have a preloader, how should I initialise `liquidGL()`?               | Add the `data-liquid-ignore` attribute to your preloader's top-level container to exclude it from the snapshot. Then call `liquidGL()` inside a `DOMContentLoaded` listener as you normally would.                                                                                                                                |
| What's the right way to use Glassworks with page animations?            | Say you have a preloader, above-the-fold intro animations, and scroll animations. The order is: 1) set `data-liquid-ignore` on the preloader, 2) animate your preloader and set up initial animation states, 3) call `liquidGL()`, 4) optionally, in `on.init()`, run any post-snapshot scripts (e.g. animate the target element). |
| Can I use Glassworks on multiple elements?                              | Yes. Any element with the class declared as your `target` gets glassified. **All elements must use the same `z-index`** because of shared canvas optimisations. If you specify different `z-index` values, the highest one wins.                                                                                                  |
| Will the library exceed WebGL contexts or have other perf issues?       | No. The library uses a shared canvas for all instances. We've tested up to 30 elements on one page without crashes or perf problems.                                                                                                                                                                                              |
| Are there animation limitations?                                        | Depends on what you're doing. Rotation and scale are expensive. `shadow`, `specular`, and `tilt` should be used carefully if you have lots of instances or complex animations, since they can clog the render pipeline.                                                                                                           |
| Why does my page lazy-load html2canvas the first time it captures?      | The snapdom build detected a `position: absolute` descendant on your snapshot target, which is a layout pattern snapdom's foreignObject pipeline can't render correctly. Glassworks fetches html2canvas at that moment and composites the absolute element on top of the snapdom base. To avoid the runtime fetch, pre-load html2canvas yourself or use the legacy build. |

---

## Important notes

- For dynamic content to be refracted in real-time, register the element(s) with `liquidGL.registerDynamic()`. Set the initial state of your animations **before** calling `liquidGL()` so they're captured correctly.
- The library ignores `fixed` position elements. This is a safety net for a known bug between html2canvas and mobile browsers that can prevent the snapshot from running. It shouldn't get in your way.
- You can have multiple instances on one page **but they must share the same `z-index`**. Different `z-index` values fall back to the highest. The effect uses a shared canvas to prevent WebGL context issues, no work-around for that.
- For better performance on complex pages, snapshot a smaller, specific element instead of the whole page (e.g. `snapshot: '.my-background'`). Less texture memory, faster captures.
- The initial capture is async. Call `liquidGL()` inside a `DOMContentLoaded` or `load` handler so content is available to the snapshot.
- Extremely long documents can exceed GPU texture limits, which causes memory or performance issues. Segment very long pages or reduce `resolution`.
- `shadow` and `tilt` create new stacking layers behind the `target`. `shadow` is at `z-index - 2`, the `tilt` helper canvas at `z-index - 1`. Leave room in your `z-index` values so they don't get clipped.
- Like any WebGL effect, image content inside the `target` needs permissive `Access-Control-Allow-Origin` headers to avoid CORS issues.

---

## Browser support

Glassworks runs on every WebGL-enabled browser on desktop, tablet, and mobile.

> [!NOTE]  
> Performance varies between browsers. Safari can be unstable when the liquid element(s) take more than ~50% of viewport width or height. Practical issues are pretty rare, but test on your target devices.

| Browser        | Supported |
| :------------- | :-------: |
| Google Chrome  |    Yes    |
| Safari         |    Yes    |
| Firefox        |    Yes    |
| Microsoft Edge |    Yes    |

---

## Other

**Exclude elements**

> You can exclude elements from the refraction by setting `data-liquid-ignore`. Add the attribute on the parent container of whatever you want to exclude.

**Content visibility**

> It's recommended to use `z-index: 3;` on the content inside your target so it sits on top of the lens. You can pair that with `mix-blend-mode: difference;` for better legibility.

**Border-radius**

> Glassworks automatically inherits the `border-radius` of the `target`, so the refraction respects rounded corners with no extra config. If you animate the `border-radius` (e.g. on scroll), the bevel animates in real time to stay in sync.

---

## Credits & licence

Glassworks is a fork of [`liquidGL`](https://github.com/naughtyduk/liquidGL) by NaughtyDuk©. The original library and its WebGL renderer were authored by NaughtyDuk. Glassworks adds the snapdom default capture pipeline, the html2canvas hybrid fallback, the long-page drift bug fix, and ongoing maintenance.

MIT © NaughtyDuk (original) · MIT © Codedgar (fork)
