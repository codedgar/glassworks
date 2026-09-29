/* Fixture loader. Query params:
 *   mode     = raw | raw-noshim | raw-otdefault | production | h2c | off
 *              (off: GLASSWORKS_TEST flag not set)
 *   snapdom  = <version>                (loads /node_modules/snapdom-<version>)
 *   lib      = current | main           (main: unmodified library from main)
 *   init     = 1 | 0                    (0: library loaded but not initialised)
 *   refraction, bevelDepth              (negative control for layer D only)
 */
(function () {
  var q = new URLSearchParams(location.search);
  var mode = q.get("mode") || "production";
  var snap = q.get("snapdom") || "2.9.0";
  if (!/^\d+\.\d+\.\d+$/.test(snap)) throw new Error("harness: bad snapdom version " + snap);
  var lib = q.get("lib") === "main" ? "/tests/.cache/liquidGL.main.js" : "/scripts/liquidGL.js";
  var fx = (window.__fixture = {
    mode: mode, snapdom: snap, lib: lib, init: q.get("init") !== "0",
    ready: false, inits: 0, lensCount: 0, target: null, error: null,
  });
  /* Modes: raw | raw-noshim | production | h2c (engine: "html2canvas") | off */
  if (mode !== "off") {
    window.GLASSWORKS_TEST = {
      rawEngine: mode === "raw" || mode === "raw-noshim" || mode === "raw-otdefault" || mode === "raw-single" || mode === "raw-ot-single",
      bgShim: mode === "raw-noshim" ? false : true,
      /* raw-otdefault: leave outerTransforms at snapdom's default. */
      snapdomOptions: mode === "raw-otdefault" || mode === "raw-ot-single" ? { outerTransforms: null } : null,
      /* ?single=1 or the raw-*-single modes: one texture sample when frost is 0. */
      singleSample: q.get("single") === "1" || mode === "raw-single" || mode === "raw-ot-single",
      snapdomVersion: snap,
      html2canvasVersion: "1.4.1",
    };
  }
  var engine = mode === "h2c" ? "html2canvas" : "snapdom";

  /* Flicker sampler (claims C12b/C13): each animation frame, count lens and
     position:fixed elements whose computed visibility is hidden. */
  var flicker = (fx.flicker = { frames: 0, hiddenFrames: 0, hiddenDuringCapture: 0, maxHidden: 0 });
  function startFlickerSampler() {
    var sel = fx.target || ".lens";
    var watched = Array.prototype.slice.call(document.querySelectorAll(sel));
    Array.prototype.forEach.call(document.body.querySelectorAll("*"), function (el) {
      if (getComputedStyle(el).position === "fixed" && el.tagName !== "CANVAS" && watched.indexOf(el) < 0) watched.push(el);
    });
    flicker.watched = watched.length;
    function tick() {
      flicker.frames++;
      var n = 0;
      for (var i = 0; i < watched.length; i++) if (getComputedStyle(watched[i]).visibility === "hidden") n++;
      if (n) {
        flicker.hiddenFrames++;
        if (window.__glassworks && window.__glassworks.capturing) flicker.hiddenDuringCapture++;
        if (n > flicker.maxHidden) flicker.maxHidden = n;
      }
      /* Supplementary: the library's own WebGL canvas (not in the watched
         set because it does not exist when sampling starts). */
      var r = window.__liquidGLRenderer__;
      if (r && r.canvas && getComputedStyle(r.canvas).visibility === "hidden") flicker.glCanvasHiddenFrames = (flicker.glCanvasHiddenFrames || 0) + 1;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  /* Production fallback lazy-loads html2canvas; point it at the local
     npm copy (same version as the library's cdnjs default). */
  window.LIQUIDGL_HTML2CANVAS_URL = "/node_modules/html2canvas/dist/html2canvas.min.js";
  document.write('<script src="/node_modules/snapdom-' + snap + '/dist/snapdom.js"><\/script>');
  document.write('<script src="' + lib + '"><\/script>');

  function num(name, dflt) {
    var v = q.get(name);
    return v === null ? dflt : parseFloat(v);
  }

  window.glassFixture = function (opts) {
    opts = opts || {};
    fx.target = opts.target || ".lens";
    var loaded = new Promise(function (r) {
      if (document.readyState === "complete") r();
      else window.addEventListener("load", r, { once: true });
    });
    loaded
      .then(function () { return opts.fontsLoad ? document.fonts.load(opts.fontsLoad) : null; })
      .then(function () { return document.fonts.ready; })
      .then(function () {
        fx.lensCount = document.querySelectorAll(fx.target).length;
        if (!fx.init) { fx.ready = true; return; }
        startFlickerSampler();
        window.liquidGL({
          engine: engine,
          target: fx.target,
          snapshot: "body",
          resolution: window.devicePixelRatio || 1,
          refraction: num("refraction", 0),
          bevelDepth: num("bevelDepth", 0),
          bevelWidth: 0.15,
          frost: 0,
          specular: false,
          shadow: false,
          tilt: false,
          reveal: "none",
          magnify: 1,
          on: {
            init: function () {
              fx.inits++;
              if (fx.inits >= fx.lensCount) fx.ready = true;
            },
          },
        });
      })
      .catch(function (e) { fx.error = String((e && e.message) || e); });
  };
})();
