<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glassworks device check</title>
<style>
  :root { color-scheme: light dark; --bg: #f4efe6; --fg: #1c1c1e; --line: #d7d2c8; --ok: #1a7f37; --bad: #c32f27; --muted: #6b6b70; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16161a; --fg: #ececf1; --line: #34343c; --ok: #4ac26b; --bad: #ff6b60; --muted: #9a9aa5; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro", Inter, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  p.sub { color: var(--muted); margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: 13px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; }
  td.n { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
  button { font: inherit; padding: 9px 14px; border-radius: 9px; border: 1px solid var(--line); background: transparent; color: inherit; }
  button:disabled { opacity: .5; }
  #status { margin: 12px 0; color: var(--muted); }
  #fixture { position: relative; height: 260px; margin: 12px 0; overflow: hidden; border: 1px solid var(--line); border-radius: 10px;
    background: repeating-linear-gradient(90deg, #cdd7e4 0 40px, #e8d9c5 40px 80px); }
  #fixture .fid { position: absolute; width: 48px; height: 48px; }
  #fixture .lens { position: absolute; left: 24px; top: 24px; width: 240px; height: 120px; border-radius: 18px; }
  #fixture p { margin: 0; padding: 12px; color: #222; }
  .wrap { max-width: 900px; margin: 0 auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Glassworks device check</h1>
  <p class="sub">Self-contained: no network requests. Runs the harness checks against SnapDOM <span id="vers"></span> in this browser.</p>
  <div id="status">Loading engines…</div>
  <button id="run">Run checks</button>
  <button id="copy" disabled>Copy JSON</button>

  <h2>Environment</h2>
  <table id="env"></table>

  <h2>1. Tall-capture threshold (per version)</h2>
  <p class="sub">Captures a 640 px-wide block at several heights and checks whether marker colours survive. Playwright's WebKit loses all content at ≈16,384 px on 2.24.15 / 3.1.0; this checks real Safari.</p>
  <table id="tall"></table>

  <h2>2. Fiducials (layer B) and blank scan (layer C)</h2>
  <table id="bc"></table>

  <h2>3. Hidden frames during capture (C12b)</h2>
  <p class="sub">Counts animation frames in which the lens or a fixed element is <code>visibility: hidden</code> while Glassworks captures.</p>
  <table id="flicker"></table>

  <h2>Fixture</h2>
  <div id="fixture">
    <p>Glassworks device-check fixture. The lens sits over these stripes and this text.</p>
    <div class="fid" data-fid="tl" style="left:16px;top:150px;background:#e6194b"></div>
    <div class="fid" data-fid="tr" style="right:16px;top:20px;background:#3cb44b"></div>
    <div class="fid" data-fid="bl" style="left:120px;top:190px;background:#4363d8"></div>
    <div class="fid" data-fid="br" style="right:120px;top:190px;background:#f58231"></div>
    <div class="lens" id="lens"></div>
  </div>
</div>

<script>/*__ENGINES__*/</script>
<script>
/* Glassworks is loaded with the test flag on so window.__glassworks exists. */
window.GLASSWORKS_TEST = { rawEngine: true, snapdomVersion: "device-check" };
</script>
<script>/*__GLASSWORKS__*/</script>
<script>
/* Any uncaught error must be visible on screen: on a real device there is no
   console to check. Also catches "this is the un-built template" (the
   version placeholder is a syntax error until build.mjs replaces it). */
window.addEventListener("error", function (e) {
  var s = document.getElementById("status");
  if (s) { s.textContent = "Script error: " + (e.message || e.error) + " — if this says 'Unexpected token', you opened tests/device-check/template.html; open the built tests/device-check.html instead."; s.style.color = "var(--bad)"; }
});
</script>
<script>
(function () {
  var VERSIONS = __VERSIONS__;
  var results = { startedAt: new Date().toISOString(), env: {}, tall: [], bc: [], flicker: {} };
  var $ = function (id) { return document.getElementById(id); };
  $("vers").textContent = VERSIONS.join(", ");
  var missing = VERSIONS.filter(function (v) { return !(window.__engines && window.__engines[v] && typeof window.__engines[v].toCanvas === "function"); });
  if (missing.length) {
    $("status").textContent = "Engines missing: " + missing.join(", ") + ". Rebuild with: node tests/device-check/build.mjs";
    $("status").style.color = "var(--bad)";
    $("run").disabled = true;
    return;
  }
  if (typeof window.liquidGL !== "function") {
    $("status").textContent = "Glassworks did not load; the hidden-frame check will be skipped.";
  }

  function row(table, cells, cls) {
    var tr = document.createElement("tr");
    cells.forEach(function (c, i) {
      var td = document.createElement(i === 0 ? "th" : "td");
      if (typeof c === "number") { td.className = "n"; c = Math.round(c * 100) / 100; }
      td.textContent = String(c);
      if (cls && i === cells.length - 1) td.className = cls;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }

  /* ---------- environment ---------- */
  function webglInfo() {
    var c = document.createElement("canvas");
    var gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { context: "none", maxTextureSize: null };
    var dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      context: (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext) ? "webgl2" : "webgl1",
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "(hidden)",
    };
  }
  var env = results.env = {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    screen: [screen.width, screen.height],
    webgl: webglInfo(),
    engines: VERSIONS,
  };
  row($("env"), ["User agent", env.userAgent]);
  row($("env"), ["devicePixelRatio", env.devicePixelRatio]);
  row($("env"), ["Viewport", env.viewport.join(" × ")]);
  row($("env"), ["WebGL", env.webgl.context + ", MAX_TEXTURE_SIZE " + env.webgl.maxTextureSize]);
  row($("env"), ["WebGL renderer", env.webgl.renderer]);

  /* ---------- helpers ---------- */
  var LIB_OPTS = { dpr: 1, outerTransforms: false, backgroundColor: "transparent", crossOrigin: "anonymous", embedFonts: true };
  function opts(extra) { var o = {}; for (var k in LIB_OPTS) o[k] = LIB_OPTS[k]; for (var k2 in extra) o[k2] = extra[k2]; return o; }
  function hex(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function sample(ctx, x, y) {
    var d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }
  function near(a, b, tol) { return a && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol && a[3] >= 240; }

  /* ---------- 1. tall-capture threshold ---------- */
  var HEIGHTS = [8000, 16000, 16300, 16384, 16500, 20000, 32768];
  var COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#469990"];
  async function tallCheck(version, H) {
    var root = document.createElement("div");
    root.style.cssText = "position:absolute;left:-99999px;top:0;width:640px;height:" + H + "px;background:#dde;overflow:hidden";
    var ys = [16];
    for (var y = 5000; y < H - 100; y += 5000) ys.push(y);
    ys.push(H - 64);
    ys.forEach(function (y, i) {
      var m = document.createElement("div");
      m.style.cssText = "position:absolute;left:296px;top:" + y + "px;width:48px;height:48px;background:" + COLORS[i % COLORS.length];
      root.appendChild(m);
    });
    document.body.appendChild(root);
    var out = { version: version, requestedHeight: H, canvas: null, markersFound: 0, markersTotal: ys.length, error: null };
    try {
      var canvas = await window.__engines[version].toCanvas(root, opts({ scale: 1 }));
      out.canvas = [canvas.width, canvas.height];
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      var k = canvas.height / H;
      ys.forEach(function (y, i) {
        var got = sample(ctx, 320 * (canvas.width / 640), (y + 24) * k);
        if (near(got, hex(COLORS[i % COLORS.length]), 24)) out.markersFound++;
      });
    } catch (e) {
      out.error = String((e && e.message) || e);
    }
    root.remove();
    out.verdict = out.error ? "error" : out.markersFound === out.markersTotal ? "all content present" : out.markersFound === 0 ? "NO CONTENT" : "partial";
    return out;
  }

  /* ---------- 2. fiducials + blank scan on the built-in fixture ---------- */
  async function bcCheck(version) {
    var host = $("fixture");
    var out = { version: version, markers: [], blankRows: null, canvas: null, error: null };
    try {
      var canvas = await window.__engines[version].toCanvas(host, opts({ scale: 1 }));
      out.canvas = [canvas.width, canvas.height];
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      var hostRect = host.getBoundingClientRect();
      var sx = canvas.width / hostRect.width, sy = canvas.height / hostRect.height;
      Array.prototype.forEach.call(host.querySelectorAll("[data-fid]"), function (el) {
        var r = el.getBoundingClientRect();
        var cx = (r.left - hostRect.left + r.width / 2) * sx;
        var cy = (r.top - hostRect.top + r.height / 2) * sy;
        var want = getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number);
        var got = sample(ctx, cx, cy);
        out.markers.push({ name: el.getAttribute("data-fid"), expected: want, actual: got, pass: near(got, want, 12) });
      });
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var blank = 0;
      for (var y = 0; y < canvas.height; y++) {
        var all = true;
        for (var x = 0; x < canvas.width && all; x++) {
          var i = (y * canvas.width + x) * 4;
          if (!(img[i + 3] <= 4 || (img[i] <= 4 && img[i + 1] <= 4 && img[i + 2] <= 4 && img[i + 3] >= 250))) all = false;
        }
        if (all) blank++;
      }
      out.blankRows = blank;
    } catch (e) {
      out.error = String((e && e.message) || e);
    }
    out.pass = !out.error && out.markers.every(function (m) { return m.pass; });
    return out;
  }

  /* ---------- 3. hidden frames while Glassworks captures ---------- */
  function flickerCheck() {
    return new Promise(function (resolve) {
      var watched = [$("lens")];
      Array.prototype.forEach.call(document.querySelectorAll("*"), function (el) {
        if (getComputedStyle(el).position === "fixed") watched.push(el);
      });
      var f = { frames: 0, hiddenFrames: 0, watched: watched.length, glCanvasHiddenFrames: 0 };
      var stop = false;
      (function tick() {
        if (stop) return;
        f.frames++;
        var n = 0;
        watched.forEach(function (el) { if (getComputedStyle(el).visibility === "hidden") n++; });
        if (n) f.hiddenFrames++;
        var r = window.__liquidGLRenderer__;
        if (r && r.canvas && getComputedStyle(r.canvas).visibility === "hidden") f.glCanvasHiddenFrames++;
        requestAnimationFrame(tick);
      })();
      // snapdom global for the library: use the newest engine.
      window.snapdom = window.__engines[VERSIONS[VERSIONS.length - 1]];
      var lens = window.liquidGL({
        target: "#lens", snapshot: "#fixture", resolution: 1,
        refraction: 0, bevelDepth: 0, frost: 0, specular: false, shadow: false, tilt: false, reveal: "none",
      });
      var captures = 0;
      var iv = setInterval(function () {
        var r = window.__liquidGLRenderer__;
        if (!r) return;
        r.captureSnapshot();
        if (++captures >= 3) {
          clearInterval(iv);
          setTimeout(function () {
            stop = true;
            f.engine = window.__glassworks ? window.__glassworks.engine : null;
            f.captures = window.__glassworks ? window.__glassworks.history.length : 0;
            f.captureMs = window.__glassworks && window.__glassworks.timings ? Math.round(window.__glassworks.timings.captureMs) : null;
            resolve(f);
          }, 1200);
        }
      }, 900);
    });
  }

  /* ---------- driver ---------- */
  async function runAll() {
    $("run").disabled = true;
    var tallT = $("tall"), bcT = $("bc"), flT = $("flicker");
    tallT.innerHTML = bcT.innerHTML = flT.innerHTML = "";
    row(tallT, ["version", "requested", "canvas", "markers", "verdict"]);
    row(bcT, ["version", "canvas", "markers passed", "blank rows", "verdict"]);
    row(flT, ["metric", "value"]);

    for (var vi = 0; vi < VERSIONS.length; vi++) {
      var v = VERSIONS[vi];
      for (var hi = 0; hi < HEIGHTS.length; hi++) {
        $("status").textContent = "Tall capture: snapdom " + v + " at " + HEIGHTS[hi] + " px…";
        await new Promise(function (r) { setTimeout(r, 0); });
        var t = await tallCheck(v, HEIGHTS[hi]);
        results.tall.push(t);
        row(tallT, [v, t.requestedHeight + " px", t.canvas ? t.canvas.join("×") : (t.error || "—"), t.markersFound + "/" + t.markersTotal, t.verdict],
          t.verdict === "all content present" ? "ok" : "bad");
      }
    }
    for (var vj = 0; vj < VERSIONS.length; vj++) {
      var v2 = VERSIONS[vj];
      $("status").textContent = "Fixture check: snapdom " + v2 + "…";
      await new Promise(function (r) { setTimeout(r, 0); });
      var b = await bcCheck(v2);
      results.bc.push(b);
      row(bcT, [v2, b.canvas ? b.canvas.join("×") : (b.error || "—"), b.markers.filter(function (m) { return m.pass; }).length + "/" + b.markers.length, b.blankRows === null ? "—" : b.blankRows, b.pass ? "pass" : "FAIL"], b.pass ? "ok" : "bad");
    }
    $("status").textContent = "Running Glassworks captures for hidden-frame count…";
    var f = await flickerCheck();
    results.flicker = f;
    row(flT, ["frames observed", f.frames]);
    row(flT, ["frames with a watched element hidden", f.hiddenFrames]);
    row(flT, ["frames with the WebGL canvas hidden", f.glCanvasHiddenFrames]);
    row(flT, ["elements watched", f.watched]);
    row(flT, ["captures / engine", (f.captures || 0) + " / " + (f.engine || "—")]);
    row(flT, ["last captureMs", f.captureMs === null ? "—" : f.captureMs]);

    results.finishedAt = new Date().toISOString();
    $("status").textContent = "Done. " + results.tall.length + " tall captures, " + results.bc.length + " fixture checks.";
    $("copy").disabled = false;
  }

  $("run").addEventListener("click", function () {
    $("status").textContent = "Starting…";
    $("status").style.color = "";
    setTimeout(function () {
      runAll().catch(function (e) {
        $("status").textContent = "Error: " + (e && e.message ? e.message : e);
        $("status").style.color = "var(--bad)";
        $("run").disabled = false;
      });
    }, 30);
  });
  $("copy").addEventListener("click", async function () {
    var text = JSON.stringify(results, null, 2);
    try { await navigator.clipboard.writeText(text); $("copy").textContent = "Copied"; }
    catch (e) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;top:0;left:0;width:100%;height:50vh;z-index:99999";
      document.body.appendChild(ta); ta.select();
      $("copy").textContent = "Select + copy";
    }
    setTimeout(function () { $("copy").textContent = "Copy JSON"; }, 2500);
  });
  $("status").textContent = "Ready. " + VERSIONS.length + " engines loaded.";
})();
</script>
</body>
</html>
