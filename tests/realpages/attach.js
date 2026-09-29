/* Harness loader for the vendored real pages.
 * Query params:
 *   mode    = raw | production | h2c | off
 *   snapdom = <version>   (loaded from /node_modules/snapdom-<version>)
 *   init    = 1 | 0       (0 = engines loaded, no lens; used for ground truth)
 *   markers = 1           (inject fiducial markers into the snapshot target)
 *
 * Glassworks' own pages call window.liquidGL() themselves, so their real
 * options are used as-is. Pages that don't (Puppertino) get lenses attached
 * to elements chosen by size, recorded in window.__fixture.attached.
 */
(function () {
  var q = new URLSearchParams(location.search);
  var mode = q.get("mode") || "raw";
  var snap = q.get("snapdom") || "2.9.0";
  if (!/^\d+\.\d+\.\d+$/.test(snap)) throw new Error("attach: bad snapdom version");
  var doInit = q.get("init") !== "0";
  var page = (document.currentScript && document.currentScript.dataset.page) || location.pathname;

  var fx = (window.__fixture = {
    page: page, mode: mode, snapdom: snap, init: doInit, ready: false, error: null,
    target: null, attached: [], ownInit: false, lensCount: 0, markers: [],
    flicker: { frames: 0, hiddenFrames: 0, hiddenDuringCapture: 0, maxHidden: 0 },
  });

  if (mode !== "off") {
    window.GLASSWORKS_TEST = {
      rawEngine: mode === "raw",
      bgShim: true,
      snapdomVersion: snap,
      html2canvasVersion: "1.4.1",
    };
  }
  window.LIQUIDGL_HTML2CANVAS_URL = "/node_modules/html2canvas/dist/html2canvas.min.js";
  document.write('<script src="/node_modules/snapdom-' + snap + '/dist/snapdom.js"><\/script>');
  if (doInit) {
    document.write('<script src="/scripts/liquidGL.js"><\/script>');
    /* Pages that call liquidGL() themselves keep their own options; only the
       engine is forced, so h2c mode applies to them too. */
    document.write(
      '<script>(function(){var o=window.liquidGL;if(!o)return;var f=' +
      JSON.stringify(mode === "h2c" ? "html2canvas" : "snapdom") +
      ';window.liquidGL=function(u){u=u||{};u.engine=f;return o.call(this,u)};' +
      'for(var k in o){window.liquidGL[k]=o[k];}})();<\/script>'
    );
  } else {
    /* Ground-truth variant: no library, but the page's own call must not throw. */
    document.write(
      '<script>window.liquidGL=function(){return[]};window.liquidGL.registerDynamic=function(){};' +
      'window.liquidGL.syncWith=function(){return{}};<\/script>'
    );
  }

  /* ---- fiducial markers (variant B): fixed-size squares at top, middle, bottom ---- */
  var COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4"];
  function injectMarkers() {
    /* Markers must live inside the element the library captures: pages may
       pass snapshot: ".main-content". If that host is statically positioned,
       it is switched to position:relative so the absolute markers anchor to
       it (recorded in fx.markerHostAdjusted). */
    var r = window.__liquidGLRenderer__;
    var host = (r && r.snapshotTarget) || document.body;
    fx.markerHost = host === document.body ? "body" : (host.className || host.tagName);
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
      fx.markerHostAdjusted = true;
    }
    var h = host.scrollHeight;
    [["top", 8], ["middle", Math.round(h / 2)], ["bottom", Math.max(0, h - 64)]].forEach(function (spec, i) {
      ["left", "right"].forEach(function (side, j) {
        var d = document.createElement("div");
        var name = spec[0] + "-" + side;
        var color = COLORS[(i * 2 + j) % COLORS.length];
        d.setAttribute("data-fid", name);
        d.style.cssText = [
          "position:absolute", "z-index:2147483646", "width:48px", "height:48px",
          "top:" + spec[1] + "px", side + ":16px", "background:" + color,
          "pointer-events:none", "margin:0", "padding:0", "border:0",
        ].join(";");
        host.appendChild(d);
        fx.markers.push({ name: name, color: color });
      });
    });
  }

  /* ---- lens attachment for pages without their own liquidGL call ---- */
  function pickTargets() {
    var picked = [];
    var seen = new Set();
    var add = function (el, why) {
      if (!el || seen.has(el)) return;
      var r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 60) return;
      seen.add(el);
      el.classList.add("glass-bench-lens");
      picked.push({ selector: why, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    };
    // Prefer elements a real integration would use: hero, nav groups, cards, sections.
    [".landing-hero", ".landing-cta", ".nav-group", "article > section", "main > section", ".p-card", "table"].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) add(el, sel);
    });
    if (!picked.length) {
      var main = document.querySelector("main") || document.body;
      Array.prototype.some.call(main.children, function (el) { add(el, "main > *"); return picked.length > 0; });
    }
    return picked.slice(0, 3);
  }

  function startFlicker() {
    var watched = Array.prototype.slice.call(document.querySelectorAll(".glass-bench-lens, .liquidGL"));
    Array.prototype.forEach.call(document.body.querySelectorAll("*"), function (el) {
      if (getComputedStyle(el).position === "fixed" && el.tagName !== "CANVAS" && watched.indexOf(el) < 0) watched.push(el);
    });
    fx.flicker.watched = watched.length;
    (function tick() {
      fx.flicker.frames++;
      var n = 0;
      for (var i = 0; i < watched.length; i++) if (getComputedStyle(watched[i]).visibility === "hidden") n++;
      if (n) {
        fx.flicker.hiddenFrames++;
        if (window.__glassworks && window.__glassworks.capturing) fx.flicker.hiddenDuringCapture++;
        if (n > fx.flicker.maxHidden) fx.flicker.maxHidden = n;
      }
      requestAnimationFrame(tick);
    })();
  }

  function ready() {
    return new Promise(function (r) {
      if (document.readyState === "complete") r();
      else window.addEventListener("load", r, { once: true });
    });
  }

  ready()
    .then(function () { return document.fonts.ready; })
    .then(function () {
      if (q.get("markers") === "1" && !doInit) injectMarkers();
      if (!doInit) {
        /* Ground truth: tag the same elements the lens variant would use. */
        pickTargets();
        fx.target = ".glass-bench-lens";
        fx.ready = true;
        return;
      }
      startFlicker();
      // Did the page initialise Glassworks itself?
      fx.ownInit = !!(window.__liquidGLRenderer__ && window.__liquidGLRenderer__.lenses.length);
      if (fx.ownInit) {
        /* Tag the page's own lenses so the harness has one selector to use. */
        window.__liquidGLRenderer__.lenses.forEach(function (l) {
          l.el.classList.add("glass-bench-lens");
          var r = l.el.getBoundingClientRect();
          fx.attached.push({ selector: "(page's own call) " + (l.el.className || l.el.tagName), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
        });
        fx.target = ".glass-bench-lens";
        fx.lensCount = window.__liquidGLRenderer__.lenses.length;
        fx.ready = true;
        return;
      }
      fx.attached = pickTargets();
      fx.target = ".glass-bench-lens";
      fx.lensCount = fx.attached.length;
      if (!fx.lensCount) { fx.error = "no lens target found"; fx.ready = true; return; }
      window.liquidGL({
        target: ".glass-bench-lens",
        snapshot: "body",
        resolution: window.devicePixelRatio || 1,
        refraction: 0, bevelDepth: 0, bevelWidth: 0.15, frost: 0,
        specular: false, shadow: false, tilt: false, reveal: "none", magnify: 1,
        engine: mode === "h2c" ? "html2canvas" : "snapdom",
        on: { init: function () { fx.ready = true; } },
      });
      // A capture failure must not hang the run.
      setTimeout(function () { fx.ready = true; }, 20000);
    })
    .then(function () {
      /* Markers are injected after load, i.e. after the page's own first
         capture, so force one more capture that contains them. */
      if (q.get("markers") !== "1" || !doInit) return;
      injectMarkers();
      var r = window.__liquidGLRenderer__;
      if (r && r.captureSnapshot) return r.captureSnapshot();
    })
    .catch(function (e) { fx.error = String((e && e.message) || e); fx.ready = true; });
})();
