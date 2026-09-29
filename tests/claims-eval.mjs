// Applies the criteria in tests/claims.md to the harness records. Each claim
// is evaluated per run, then runs are combined: all runs agree -> that
// verdict; otherwise (or fewer than 3 runs, or a harness error) -> inconclusive.
import { stats, round2 } from "./lib/measure.mjs";

const R = "reproduced", N = "not reproduced", I = "inconclusive", U = "untestable";
const VERSIONS = ["2.9.0", "2.24.15", "3.1.0"];
const BROWSERS = ["chromium", "firefox", "webkit"];
const H2C = "html2canvas (SnapDOM not used)";

function combine(runVerdicts, minRuns = 3) {
  const v = runVerdicts.map((r) => r.verdict);
  if (!v.length) return { verdict: U, note: "no records" };
  if (v.every((x) => x === U)) return { verdict: U };
  if (v.length < minRuns) return { verdict: I, note: `only ${v.length} run(s)` };
  if (v.every((x) => x === v[0])) return { verdict: v[0] };
  return { verdict: I, note: `runs disagree: ${v.join(" / ")}` };
}

const pts = (rec) => new Map(((rec && rec.layers && rec.layers.B && rec.layers.B.markers) || []).map((m) => [m.name, m]));
const short = (m) => (m ? `${m.name}: exp ${m.expected.slice(0, 3)} got ${m.actual ? m.actual.join(",") : "out of bounds"}` : "");
const artifactDir = (rec) => rec && rec.layers && rec.layers.A && rec.layers.A.artifacts ? rec.layers.A.artifacts.capture.replace(/\/run\d+\/capture\.png$/, "/run*/") : null;

export function evaluateClaims(recs) {
  const fx = recs.filter((r) => r.kind === "fixture" && r.phase === "2");
  const lab = recs.filter((r) => r.kind === "lab");
  const timing = recs.filter((r) => r.kind === "timing");
  const F = (fixture, mode, version, browser) => fx.filter((r) => r.fixture === fixture && r.mode === mode && r.snapdomVersion === version && r.browser === browser).sort((a, b) => a.run - b.run);
  const L = (id, version, browser) => lab.filter((r) => r.id === id && r.snapdomVersion === version && r.browser === browser).sort((a, b) => a.run - b.run);
  const T = (fixture, mode, version, browser) => timing.filter((r) => r.fixture === fixture && r.mode === mode && r.snapdomVersion === version && r.browser === browser).sort((a, b) => a.run - b.run);

  const claims = [];
  // Build a table over versions x browsers from a per-run evaluator over `runsOf(version, browser)`.
  function table(id, title, runsOf, evalRun, { versions = VERSIONS, versionLabel } = {}) {
    const rows = [];
    for (const version of versions)
      for (const browser of BROWSERS) {
        const runs = runsOf(version, browser);
        const per = runs.map((r) => (r.harnessError ? { verdict: I, metric: "harness error" } : evalRun(r, version, browser)));
        const c = combine(per);
        rows.push({ version: versionLabel || version, browser, verdict: c.verdict, note: c.note, runs: per.length, metrics: [...new Set(per.map((p) => p.metric).filter(Boolean))], artifacts: [...new Set(per.map((p) => p.artifact).filter(Boolean))] });
      }
    claims.push({ id, title, rows });
  }

  /* C01 / C02 / C17 on bg-variants raw-noshim */
  const bgGroups = (rec) => {
    const m = pts(rec);
    const g = (pre) => [...m.values()].filter((x) => x.name.startsWith(pre));
    return { png: [...g("png-file."), ...g("png-data.")], svg: [...g("svg-file."), ...g("svg-data.")], ctrl: g("img-control."), grad: g("gradient.") };
  };
  const anyNonPass = (list) => list.find((x) => x.verdict !== "pass");
  table("C01", "WebKit: CSS background-image url() does not paint in SnapDOM's foreignObject; <img> does", (v, b) => F("bg-variants", "raw-noshim", v, b), (rec) => {
    const g = bgGroups(rec);
    if (!g.ctrl.length || g.ctrl.some((x) => x.verdict !== "pass")) return { verdict: I, metric: `<img> control failed: ${short(anyNonPass(g.ctrl))}` };
    const url = [...g.png, ...g.svg];
    if (url.some((x) => x.verdict === "inconclusive")) return { verdict: I, metric: "ground truth failed a point" };
    const bad = url.filter((x) => x.verdict === "fail");
    return { verdict: bad.length ? R : N, metric: bad.length ? `${bad.length}/${url.length} url() points fail; ${bad.slice(0, 4).map(short).join("; ")}` : `${url.length}/${url.length} url() points pass`, artifact: artifactDir(rec) };
  });
  table("C02", "The WebKit bg-image failure is specific to SVG (PNG paints)", (v, b) => F("bg-variants", "raw-noshim", v, b), (rec) => {
    const g = bgGroups(rec);
    if (!g.ctrl.length || g.ctrl.some((x) => x.verdict !== "pass")) return { verdict: I, metric: "<img> control failed" };
    const svgBad = g.svg.filter((x) => x.verdict !== "pass").length, pngBad = g.png.filter((x) => x.verdict !== "pass").length;
    return { verdict: svgBad && !pngBad ? R : N, metric: `SVG points failing ${svgBad}/${g.svg.length}, PNG points failing ${pngBad}/${g.png.length}`, artifact: artifactDir(rec) };
  });
  table("C03", "The same WebKit bg-image bug affects html2canvas", (v, b) => F("bg-variants", "h2c", "2.9.0", b), (rec) => {
    if (rec.layers.B && rec.layers.B.verdict === "unmeasurable") return { verdict: I, metric: rec.layers.B.reason };
    const g = bgGroups(rec);
    const url = [...g.png, ...g.svg];
    const bad = url.filter((x) => x.verdict === "fail");
    return { verdict: bad.length ? R : N, metric: bad.length ? `${bad.length}/${url.length} url() points fail; ${bad.slice(0, 4).map(short).join("; ")}` : `${url.length}/${url.length} url() points pass`, artifact: artifactDir(rec) };
  }, { versions: ["2.9.0"], versionLabel: H2C });

  /* C04 long-page raw */
  table("C04", "Chromium clips SnapDOM output beyond the first viewport on long pages; WebKit captures full height", (v, b) => F("long-page", "raw", v, b), (rec) => {
    const m = [...pts(rec).values()];
    const H = rec.geometry.target.rectDoc[3];
    const top = m.filter((x) => x.cssPos[1] <= 800), below = m.filter((x) => x.cssPos[1] > 800);
    if (top.some((x) => x.verdict !== "pass")) return { verdict: I, metric: "top markers fail" };
    const bad = below.filter((x) => x.verdict !== "pass");
    const stop = rec.layers.C.contentStopsAtCss;
    const early = stop !== null && stop < H - 2;
    return { verdict: bad.length || early ? R : N, metric: `below-viewport markers failing ${bad.length}/${below.length}; content stops at ${stop === null ? "never" : stop + " CSS px"} of ${H}; capture ${rec.layers.A.captureSize.join("×")} at scale ${round2(rec.scale)}`, artifact: artifactDir(rec) };
  });

  /* C05 / C06 lab tall */
  const tallIds = ["tall-20000-scale-lib", "tall-20000-scale-1", "tall-40000-scale-lib", "tall-40000-scale-1"];
  function tallRuns(ids, v, b) {
    // Group the four lab records by run index.
    const byRun = new Map();
    for (const id of ids) for (const r of L(id, v, b)) { if (!byRun.has(r.run)) byRun.set(r.run, []); byRun.get(r.run).push(r); }
    return [...byRun.entries()].sort((a, b2) => a[0] - b2[0]).map(([run, list]) => ({ run, list, harnessError: list.find((x) => x.harnessError) ? "error" : undefined }));
  }
  // Tall captures: the registered check samples markers at proportionally
  // scaled positions. `located` (tests/lib/locate.mjs) records where each
  // marker colour actually is, to tell misregistration from missing content.
  const locSummary = (c) => {
    if (!c.located) return "";
    const miss = c.located.filter((l) => !l.found).length;
    const offs = c.located.filter((l) => l.found).map((l) => l.offsetPx);
    return miss === c.located.length ? "; located: no marker colour in the centre column"
      : `; located: ${c.located.length - miss}/${c.located.length} markers present${offs.length ? `, offsets ${Math.min(...offs)}..${Math.max(...offs)} px` : ""}`;
  };
  table("C05", "Chromium clipping appears on pages longer than 11,600 px (20,000 / 40,000 px)", (v, b) => tallRuns(tallIds, v, b), (g) => {
    const per = g.list.map((r) => {
      const c = r.captures[0];
      if (!c || c.error) return { v: I, m: `${r.id}: capture error ${c ? c.error : ""}` };
      const top = c.points.find((p) => p.cssY <= 800), below = c.points.filter((p) => p.cssY > 800);
      const bad = below.filter((p) => p.verdict !== "pass");
      const early = c.blank.contentStopsAt !== null && c.blank.contentStopsAt < c.height - 2;
      const m = `${r.id}: ${c.width}×${c.height}, registered check: top ${top.verdict}, below-viewport fails ${bad.length}/${below.length}${early ? `, blank from row ${c.blank.contentStopsAt}` : ""}${locSummary(c)}`;
      if (top.verdict !== "pass") return { v: I, m };
      if (!bad.length && !early) return { v: N, m };
      // Registered condition met: only evidence of clipping if content is actually absent.
      const belowLoc = (c.located || []).filter((l) => below.some((p) => p.name === l.name));
      if (belowLoc.length && belowLoc.every((l) => l.found)) return { v: I, m: m + " (all below-viewport markers present: misregistration/letterboxing, not isolated as clipping)" };
      return { v: R, m };
    });
    const vs = per.map((x) => x.v);
    const verdict = g.list.length < 4 ? I : vs.includes(R) ? R : vs.every((x) => x === N) ? N : I;
    return { verdict, metric: per.map((x) => x.m).join("; ") };
  });
  table("C06", "Captures above 16,384 px per side are downscaled to ≤ 16,384, not clipped", (v, b) => tallRuns(["tall-20000-scale-1", "tall-40000-scale-1"], v, b), (g) => {
    const out = g.list.map((r) => {
      const c = r.captures[0];
      if (!c || c.error) return { v: I, m: `${r.id}: error ${c ? c.error : ""}` };
      const base = `${r.id}: ${c.width}×${c.height}`;
      if (c.height > 16384) return { v: N, m: `${base} (no 16,384 cap)` };
      if (c.points.every((p) => p.verdict === "pass")) return { v: R, m: `${base}, markers all pass at scaled positions` };
      const loc = c.located || [];
      if (loc.length && loc.every((l) => l.found)) return { v: I, m: `${base}, registered positional check fails${locSummary(c)} (downscaled, content present, not proportional)` };
      return { v: N, m: `${base}, markers fail${locSummary(c)}` };
    });
    const vs = out.map((o) => o.v);
    const verdict = g.list.length < 2 ? I : vs.every((x) => x === R) ? R : vs.includes(N) ? N : I;
    return { verdict, metric: out.map((o) => o.m).join("; ") };
  });

  /* C07 / C08 offscreen */
  const offscreen = (kind) => (rec) => {
    const [off, inv] = rec.captures;
    if (!off || !inv || off.error || inv.error) return { verdict: I, metric: `capture error: ${(off && off.error) || (inv && inv.error)}` };
    const pOff = off.points[0], pIn = inv.points[0];
    if (pIn.verdict !== "pass") return { verdict: I, metric: `in-view control failed (${pIn.actual})` };
    const offBad = pOff.verdict !== "pass" || off.blank.blankRowRatio >= 0.99;
    return { verdict: offBad ? R : N, metric: `off-screen centre ${pOff.actual ? pOff.actual.join(",") : "oob"} (${pOff.verdict}), blank rows ${off.blank.blankRows}/${off.blank.rows}; in-view ${pIn.verdict}`, artifact: off.artifact };
  };
  for (const kind of ["div", "img", "svg", "canvas"])
    table(`C07-${kind}`, `Off-screen <${kind}> comes back empty (only in-viewport content is rasterised)`, (v, b) => L(`offscreen-${kind}`, v, b), offscreen(kind));
  {
    const rows = [];
    const c07 = (k) => claims.find((c) => c.id === `C07-${k}`);
    for (let i = 0; i < c07("svg").rows.length; i++) {
      const s = c07("svg").rows[i], c = c07("canvas").rows[i];
      const verdict = s.verdict === R || c.verdict === R ? R : s.verdict === N && c.verdict === N ? N : I;
      rows.push({ version: s.version, browser: s.browser, verdict, runs: s.runs, metrics: [`svg: ${s.verdict}; canvas: ${c.verdict}`], artifacts: [] });
    }
    claims.push({ id: "C08", title: "Off-screen failures occur for <svg> and other elements (derived from C07-svg / C07-canvas)", rows });
  }

  /* C09 repro */
  table("C09", "liquidGL#11 repro: 11,600 px element captured at full height with expected pixels", (v, b) => L("repro", v, b), (rec) => {
    const c = rec.captures[0];
    if (!c || c.error) return { verdict: N, metric: `capture error: ${c && c.error}` };
    const bad = c.points.filter((p) => p.verdict !== "pass");
    const hOk = c.height === c.offsetHeight;
    return { verdict: hOk && !bad.length ? R : N, metric: `height ${c.height} vs offsetHeight ${c.offsetHeight}; ${c.points.map((p) => `${p.name} Δ${p.maxDelta}${p.verdict === "pass" ? "" : " FAIL"}`).join(", ")}`, artifact: c.artifact };
  });

  /* C10 / C11 absolute overlay */
  table("C10", "position:absolute descendants with a viewport containing block drop out of SnapDOM's rasterisation", (v, b) => F("absolute-overlay", "raw", v, b), (rec) => {
    const m = pts(rec);
    const a = m.get("abs-a"), bb = m.get("abs-b"), c = m.get("abs-rel");
    if (!c || c.verdict !== "pass") return { verdict: I, metric: `control abs-rel ${c ? c.verdict : "missing"}` };
    const bad = [a, bb].filter((x) => x && x.verdict !== "pass");
    return { verdict: bad.length ? R : N, metric: `abs-a ${a && a.verdict}, abs-b ${bb && bb.verdict}, abs-rel ${c.verdict}`, artifact: artifactDir(rec) };
  });
  table("C11", "Glassworks detects absolute descendants and lazy-loads html2canvas", (v, b) => F("absolute-overlay", "production", v, b), (rec) => {
    const ran = (rec.capture && rec.capture.history || []).some((h) => h.fallbackRan);
    return { verdict: ran || rec.html2canvasRequested ? R : N, metric: `fallback ran: ${ran}; html2canvas requested: ${rec.html2canvasRequested}` };
  });

  /* C12a hook */
  table("C12a", "SnapDOM has no onclone-style hook (tested via afterClone plugin)", (v, b) => L("hook", v, b), (rec) => {
    const c = rec.captures[0];
    if (!c || c.error) return { verdict: I, metric: `capture error: ${c && c.error}` };
    const p = c.points[0];
    const metric = `afterClone invoked ${c.hookInvoked}×, clone nodes found ${c.hookFoundNodes}, marker in capture: ${p.verdict === "pass" ? "absent" : "present"}, live-DOM mutations ${c.liveMutations}`;
    if (!c.hookInvoked || p.verdict !== "pass") return { verdict: R, metric };
    if (c.liveMutations === 0) return { verdict: N, metric, artifact: c.artifact };
    return { verdict: I, metric };
  });

  /* C12b / C13 flicker: per run, over all fixtures in raw + production */
  function flickerRuns(v, b) {
    const byRun = new Map();
    for (const r of fx.filter((r) => r.snapdomVersion === v && r.browser === b && (r.mode === "raw" || r.mode === "production")))
      (byRun.get(r.run) || byRun.set(r.run, []).get(r.run)).push(r);
    return [...byRun.entries()].sort((a, c) => a[0] - c[0]).map(([run, list]) => ({ run, list }));
  }
  const flickerMetric = (g) => {
    const hidden = g.list.filter((r) => r.flicker && r.flicker.hiddenFrames > 0);
    const frames = g.list.reduce((s, r) => s + ((r.flicker && r.flicker.hiddenFrames) || 0), 0);
    const total = g.list.reduce((s, r) => s + ((r.flicker && r.flicker.frames) || 0), 0);
    const gl = g.list.reduce((s, r) => s + ((r.flicker && r.flicker.glCanvasHiddenFrames) || 0), 0);
    return { hidden, text: `fixtures with hidden frames ${hidden.length}/${g.list.length}; hidden frames ${frames}/${total}; (supplementary) WebGL canvas hidden frames ${gl}` };
  };
  table("C12b", "Live-DOM hiding during capture: lenses / fixed UI observed hidden in rendered frames", flickerRuns, (g) => {
    const m = flickerMetric(g);
    return { verdict: m.hidden.length ? R : N, metric: m.text };
  });
  table("C13", "Glassworks hides in the clone (\"snapdom equivalent\" of onclone), so no flicker", flickerRuns, (g) => {
    const m = flickerMetric(g);
    return { verdict: m.hidden.length ? N : R, metric: m.text };
  });

  /* C14 filter */
  table("C14", "SnapDOM's filter option inflates the capture bounding box ~1.6×", (v, b) => L("filter", v, b), (rec) => {
    const [a, f] = rec.captures;
    if (!a || !f || a.error || f.error) return { verdict: I, metric: `capture error: ${(a && a.error) || (f && f.error)}` };
    const rw = round2(f.width / a.width), rh = round2(f.height / a.height);
    const verdict = rw >= 1.3 || rh >= 1.3 ? R : Math.abs(rw - 1) <= 0.05 && Math.abs(rh - 1) <= 0.05 ? N : I;
    return { verdict, metric: `no filter ${a.width}×${a.height}, filter ${f.width}×${f.height} (ratio ${rw}, ${rh}); filtered marker ${f.points[0].verdict === "pass" ? "absent" : "present"}`, artifact: f.artifact };
  });

  /* C15 larger canvas, all raw fixtures per run */
  function rawRuns(v, b) {
    const byRun = new Map();
    for (const r of fx.filter((r) => r.snapdomVersion === v && r.browser === b && r.mode === "raw"))
      (byRun.get(r.run) || byRun.set(r.run, []).get(r.run)).push(r);
    return [...byRun.entries()].sort((a, c) => a[0] - c[0]).map(([run, list]) => ({ run, list }));
  }
  table("C15", "SnapDOM returns a canvas a few px larger than scale × source", rawRuns, (g) => {
    const over = [], exact = [];
    for (const r of g.list) {
      const A = r.layers.A;
      if (!A || !A.captureSize) continue;
      const dx = A.captureSize[0] - A.expectedSize[0], dy = A.captureSize[1] - A.expectedSize[1];
      (dx >= 1 || dy >= 1 ? over : exact).push(`${r.fixture} +${dx}/+${dy}`);
    }
    return { verdict: over.length ? R : N, metric: `larger on ${over.length}/${over.length + exact.length} fixtures (${[...new Set(over.map((s) => s.split(" ")[1]))].join(", ")})` };
  });

  /* C16 transform */
  table("C16", "Without outerTransforms:false a transformed root captures empty", (v, b) => L("transform", v, b), (rec) => {
    const [d, f] = rec.captures;
    if (!d || !f || d.error || f.error) return { verdict: I, metric: `capture error: ${(d && d.error) || (f && f.error)}` };
    if (f.points[0].verdict !== "pass") return { verdict: I, metric: "outerTransforms:false control failed" };
    const bad = d.points[0].verdict !== "pass" || d.blank.blankRowRatio >= 0.9;
    return { verdict: bad ? R : N, metric: `default: ${d.width}×${d.height}, centre ${d.points[0].actual} (${d.points[0].verdict}), blank rows ${d.blank.blankRows}/${d.blank.rows}; control pass`, artifact: d.artifact };
  });

  /* C17 gradients */
  table("C17", "SnapDOM renders CSS gradients correctly, including on WebKit", (v, b) => F("bg-variants", "raw-noshim", v, b), (rec) => {
    const g = bgGroups(rec);
    const bad = g.grad.filter((x) => x.verdict !== "pass");
    return { verdict: g.grad.length && !bad.length ? R : N, metric: `gradient points failing ${bad.length}/${g.grad.length}${bad.length ? "; " + bad.map(short).join("; ") : ""}`, artifact: artifactDir(rec) };
  });

  /* C18 clipping, raw vs h2c paired by run index */
  table("C18", "SnapDOM does not honour overflow / clip-path / mask clipping the way html2canvas does", (v, b) => F("clip", "raw", v, b).map((r) => ({ ...r, h2c: F("clip", "h2c", "2.9.0", b).find((x) => x.run === r.run) })), (rec) => {
    if (!rec.h2c || rec.h2c.harnessError) return { verdict: I, metric: "no h2c run" };
    if (rec.h2c.layers.B.verdict === "unmeasurable") return { verdict: I, metric: `h2c ${rec.h2c.layers.B.reason}` };
    const raw = pts(rec), h = pts(rec.h2c);
    let repro = false;
    const parts = ["overflow", "clip-path", "mask"].map((k) => {
      const ro = raw.get(`${k}.outside`), ho = h.get(`${k}.outside`);
      if (!ro || ro.verdict === "inconclusive") return `${k}: ground truth failed`;
      const rawClipped = ro.verdict === "pass", h2cClipped = ho && ho.verdict === "pass";
      if (!rawClipped && h2cClipped) repro = true;
      return `${k}: SnapDOM ${rawClipped ? "clipped" : "NOT clipped"}, html2canvas ${h2cClipped ? "clipped" : "NOT clipped"}`;
    });
    const gtBad = parts.some((p) => p.includes("ground truth failed"));
    return { verdict: repro ? R : gtBad ? I : N, metric: parts.join("; "), artifact: artifactDir(rec) };
  });

  /* C19 hide window (timing pass), Chromium per claim; other browsers reported */
  table("C19", "Live-DOM hide window is ~50–200 ms on Chromium for a viewport-sized capture", (v, b) => T("baseline", "raw", v, b), (rec) => {
    const med = rec.warmHideWindowMs.median;
    return { verdict: med >= 50 && med <= 200 ? R : N, metric: `warm hide window median ${med} ms (${rec.warmHideWindowMs.min}–${rec.warmHideWindowMs.max})` };
  });

  /* C20 speed ratio */
  for (const fixture of ["baseline", "long-page"])
    for (const sub of ["faster", "~4x"])
      table(`C20-${fixture}-${sub}`, `SnapDOM ${sub === "faster" ? "is faster than" : "is ~4× faster than"} html2canvas (${fixture}, warm captureMs)`, (v, b) => T(fixture, "raw", v, b).map((r) => ({ ...r, h2c: T(fixture, "h2c", "2.9.0", b).find((x) => x.run === r.run) })), (rec) => {
        if (!rec.h2c || rec.h2c.harnessError) return { verdict: I, metric: "no h2c timing run" };
        const s = rec.warmCaptureMs.median, h = rec.h2c.warmCaptureMs.median;
        const ratio = round2(h / s);
        const ok = sub === "faster" ? ratio > 1 : ratio >= 3 && ratio <= 5;
        return { verdict: ok ? R : N, metric: `html2canvas ${h} ms / SnapDOM ${s} ms = ${ratio}×` };
      });

  /* C21 hybrid slower than html2canvas alone */
  table("C21", "When the fallback runs, the hybrid is slower than html2canvas alone", (v, b) =>
    fx.filter((r) => r.snapdomVersion === v && r.browser === b && r.mode === "production" && (r.capture && r.capture.history || []).some((h) => h.fallbackRan)), (rec, v, b) => {
    const fb = rec.capture.history.find((h) => h.fallbackRan);
    const h2cRecs = [...T(rec.fixture, "h2c", "2.9.0", b), ...F(rec.fixture, "h2c", "2.9.0", b)];
    const ref = stats(h2cRecs.flatMap((r) => r.kind === "timing" ? r.warm.map((w) => w && w.timings.captureMs) : (r.layers.E && r.layers.E.warm) || []));
    if (!ref.n) return { verdict: U, metric: `fallback ran on ${rec.fixture} (${fb.fallbackReason}) but no h2c run exists for that fixture` };
    return { verdict: fb.timings.captureMs > ref.median ? R : N, metric: `${rec.fixture}: fallback capture ${round2(fb.timings.captureMs)} ms vs h2c median ${ref.median} ms` };
  });

  return claims;
}

export const CLAIM_VERDICTS = { R, N, I, U };
