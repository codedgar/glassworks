// Aggregates test-results/records/*.json into report.json + report.md.
// Verdicts are only ever derived from recorded numbers.
import fs from "node:fs";
import path from "node:path";
import { RECORDS, RESULTS, ROOT } from "./lib/record.mjs";
import { CRITERIA } from "./lib/criteria.mjs";
import { stats } from "./lib/measure.mjs";
import { evaluateClaims } from "./claims-eval.mjs";
import { locateMarkers } from "./lib/locate.mjs";

const LAYERS = ["A", "B", "C", "D"];

function combine(verdicts) {
  if (!verdicts.length || verdicts.some((v) => v === undefined || v === null)) return "inconclusive";
  if (verdicts.every((v) => v === "n/a")) return "n/a";
  if (verdicts.every((v) => v === "unmeasurable")) return "unmeasurable";
  if (verdicts.every((v) => v === "pass")) return "pass";
  if (verdicts.every((v) => v === "fail")) return "fail";
  return "inconclusive";
}

const pct = (x) => (x === null || x === undefined ? "–" : (x * 100).toFixed(2) + "%");
const uniq = (a) => [...new Set(a.map((x) => JSON.stringify(x === undefined ? null : x)))].map((x) => JSON.parse(x));
const pkgVersion = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"))).version; } catch { return null; }
};

export async function buildReport() {
  if (!fs.existsSync(RECORDS)) return;
  const recs = fs.readdirSync(RECORDS).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(RECORDS, f))));
  const fixtures = recs.filter((r) => r.kind === "fixture");
  const negatives = recs.filter((r) => r.kind === "negative-control");
  const equivalence = recs.filter((r) => r.kind === "equivalence");
  const tiling = recs.filter((r) => r.kind === "tiling-control");

  // ---- aggregate fixture runs ----
  const groups = new Map();
  for (const r of fixtures) {
    const key = [r.fixture, r.browser, r.snapdomVersion, r.mode].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const combos = [...groups.entries()].map(([key, runs]) => {
    runs.sort((a, b) => a.run - b.run);
    const [fixture, browser, snapdomVersion, mode] = key.split("|");
    const errored = runs.filter((r) => r.harnessError);
    const verdict = {};
    for (const L of LAYERS) verdict[L] = combine(runs.map((r) => (r.harnessError ? undefined : r.layers[L] && r.layers[L].verdict)));
    const ok = runs.filter((r) => !r.harnessError);
    const failingMarkers = uniq(ok.flatMap((r) => ((r.layers.B && r.layers.B.markers) || []).filter((m) => m.verdict !== "pass").map((m) => ({ name: m.name, verdict: m.verdict, reason: m.reason, expected: m.expected, actual: m.actual, imagePos: m.imagePos }))));
    const warmAll = ok.flatMap((r) => (r.layers.E && r.layers.E.warm) || []);
    return {
      fixture, browser, browserVersion: runs[0].browserVersion, snapdomVersion, mode,
      runs: runs.length, harnessErrors: errored.map((r) => ({ run: r.run, error: r.harnessError.split("\n")[0] })),
      verdict,
      capture: {
        engines: uniq(ok.map((r) => r.capture && r.capture.engine)),
        engineVersions: uniq(ok.map((r) => r.capture && r.capture.engineVersion)),
        fallbackRan: uniq(ok.map((r) => r.capture && (r.capture.history || []).some((h) => h.fallbackRan))),
        fallbackReasons: uniq(ok.flatMap((r) => (r.capture ? r.capture.history : []).map((h) => h.fallbackReason).filter(Boolean))),
        fallbackSuppressed: uniq(ok.map((r) => r.capture && (r.capture.history || []).some((h) => h.fallbackSuppressed))),
        capturesOnLoad: ok.map((r) => r.capture && r.capture.capturesOnLoad),
        captureErrors: uniq(ok.flatMap((r) => (r.capture ? r.capture.history : []).map((h) => h.error).filter(Boolean))),
        scale: uniq(ok.map((r) => r.scale)),
        gl: uniq(ok.map((r) => r.gl)),
        fontLoaded: fixture === "webfont" ? uniq(ok.map((r) => r.fontLoaded)) : undefined,
      },
      A: {
        diffRatio: ok.map((r) => r.layers.A && r.layers.A.diffRatio),
        captureSize: uniq(ok.map((r) => r.layers.A && r.layers.A.captureSize)),
        expectedSize: uniq(ok.map((r) => r.layers.A && r.layers.A.expectedSize)),
        groundTruthResampled: uniq(ok.map((r) => r.layers.A && r.layers.A.groundTruthResampled)),
        bestShift: uniq(ok.map((r) => r.layers.A && r.layers.A.bestShift)),
        diffRatioAtBestShift: ok.map((r) => r.layers.A && r.layers.A.diffRatioAtBestShift),
        reason: uniq(ok.map((r) => r.layers.A && r.layers.A.reason).filter(Boolean)),
      },
      B: { failingMarkers, markerCount: ok[0] && ok[0].layers.B && ok[0].layers.B.markers ? ok[0].layers.B.markers.length : 0 },
      C: {
        blankRows: ok.map((r) => r.layers.C && r.layers.C.blankRows),
        blankCols: ok.map((r) => r.layers.C && r.layers.C.blankCols),
        transparentRows: ok.map((r) => r.layers.C && r.layers.C.transparentRows),
        blackRows: ok.map((r) => r.layers.C && r.layers.C.blackRows),
        blankEdges: uniq(ok.map((r) => r.layers.C && r.layers.C.blankEdges)),
        contentStopsAtCss: uniq(ok.map((r) => r.layers.C && r.layers.C.contentStopsAtCss)),
      },
      D: {
        lenses: ok.map((r) => ((r.layers.D && r.layers.D.lenses) || []).map((l) => ({ lens: l.lens, diffRatio: l.diffRatio }))),
        reason: uniq(ok.map((r) => r.layers.D && r.layers.D.reason).filter(Boolean)),
      },
      E: {
        cold: stats(ok.map((r) => r.layers.E && r.layers.E.cold)),
        coldValues: ok.map((r) => r.layers.E && r.layers.E.cold),
        warm: stats(warmAll),
        warmEngines: uniq(ok.flatMap((r) => (r.layers.E && r.layers.E.warmEngines) || [])),
        snapdomMsCold: stats(ok.map((r) => { const h = r.capture && r.capture.history.find((x) => !x.error); return h && h.timings.snapdomMs; })),
      },
      artifacts: runs.map((r) => ({ run: r.run, A: r.layers.A && r.layers.A.artifacts, D: ((r.layers.D && r.layers.D.lenses) || []).map((l) => l.artifacts) })),
      external: uniq(runs.flatMap((r) => r.external || [])),
    };
  });
  combos.sort((a, b) => [a.snapdomVersion, a.fixture, a.browser, a.mode].join().localeCompare([b.snapdomVersion, b.fixture, b.browser, b.mode].join()));

  const negativeSummary = negatives.map((n) => ({ browser: n.browser, run: n.run, allDetected: n.checks.every((c) => c.detected), checks: n.checks }));
  const eqSummary = equivalence.map((e) => ({ browser: e.browser, fixture: e.fixture, run: e.run, verdict: e.verdict, hookPresentWhenOff: e.hookPresentWhenOff, control: e.control, subject: e.subject }));

  let baseCommit = null;
  try { baseCommit = fs.readFileSync(path.join(ROOT, "tests/.cache/base-commit.txt"), "utf8").trim(); } catch {}
  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      playwright: pkgVersion("@playwright/test"),
      browsers: uniq(fixtures.map((r) => ({ browser: r.browser, version: r.browserVersion }))),
      snapdomVersions: uniq(fixtures.map((r) => r.snapdomVersion)),
      html2canvas: pkgVersion("html2canvas"),
      unmodifiedLibraryCommit: baseCommit,
      viewport: [1280, 800],
      deviceScaleFactor: Number(process.env.GLASS_DSF || 1),
    },
    criteria: CRITERIA,
    negativeControl: negativeSummary,
    tilingControl: tiling,
    equivalence: eqSummary,
    combos,
  };
  const phase2 = recs.some((r) => r.kind === "lab" || r.kind === "timing" || (r.kind === "fixture" && r.phase === "2"));
  if (phase2) report.phase2 = phase2Data(recs);
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(RESULTS, "report.md"), (phase2 ? phase2Markdown(report.phase2) + "\n\n---\n\n# Layer results (all fixtures)\n\n" : "") + toMarkdown(report));
}

const V = { pass: "PASS", fail: "FAIL", inconclusive: "INCONCL", "n/a": "n/a", unmeasurable: "UNREADABLE" };

function toMarkdown(r) {
  const L = [];
  const env = r.environment;
  L.push(`# Glassworks harness report`, ``, `Generated ${r.generatedAt}. Criteria: \`tests/CRITERIA.md\`.`, ``);
  L.push(`| | |`, `|---|---|`);
  L.push(`| Node | ${env.node} |`, `| Playwright | ${env.playwright} |`);
  L.push(`| Browsers | ${env.browsers.map((b) => `${b.browser} ${b.version}`).join(", ")} |`);
  L.push(`| SnapDOM | ${env.snapdomVersions.join(", ")} |`, `| html2canvas (fallback) | ${env.html2canvas} |`);
  L.push(`| Viewport / DSF | ${env.viewport.join("×")} / ${env.deviceScaleFactor} |`, `| Unmodified library commit | ${env.unmodifiedLibraryCommit} |`, ``);

  L.push(`## Harness integrity`, ``, `### Negative control`, ``);
  if (!r.negativeControl.length) L.push(`_not run_`);
  for (const n of r.negativeControl) {
    L.push(`**${n.browser} run ${n.run}: ${n.allDetected ? "all controls behaved as expected" : "CONTROL NOT DETECTED"}**`, ``);
    L.push(`| check | expected | got | metric |`, `|---|---|---|---|`);
    for (const c of n.checks) L.push(`| ${c.name} | ${c.expected} | ${c.verdict}${c.detected ? "" : " ⚠"} | \`${JSON.stringify(c.metric)}\` |`);
    L.push(``);
  }
  L.push(`### Ground-truth tiling control (long-page)`, ``);
  if (!r.tilingControl.length) L.push(`_not run_`);
  else {
    L.push(`| browser | run | tiles | markers in tiled GT | tiled vs single-shot diff | single-shot error |`, `|---|---|---|---|---|---|`);
    for (const t of r.tilingControl) L.push(`| ${t.browser} | ${t.run} | ${t.tiles} | ${t.tiledFiducials}${t.failing.length ? " (" + t.failing.join(",") + ")" : ""} | ${t.diffRatioTiledVsSingle === null ? "–" : pct(t.diffRatioTiledVsSingle)} | ${t.singleShotError || "–"} |`);
  }
  L.push(``);
  L.push(`### Flag-off equivalence (unmodified vs modified library, \`GLASSWORKS_TEST\` unset)`, ``);
  if (!r.equivalence.length) L.push(`_not run_`);
  else {
    L.push(`| browser | fixture | run | verdict | control main↔main (snapshot / webgl px) | main↔modified (snapshot / webgl px) | hook present |`, `|---|---|---|---|---|---|---|`);
    const px = (d) => (d.comparable ? d.diffPixels : "size≠");
    for (const e of r.equivalence.sort((a, b) => (a.browser + a.fixture).localeCompare(b.browser + b.fixture)))
      L.push(`| ${e.browser} | ${e.fixture} | ${e.run} | ${e.verdict} | ${px(e.control.snapshot)} / ${px(e.control.webgl)} | ${px(e.subject.snapshot)} / ${px(e.subject.webgl)} | ${e.hookPresentWhenOff} |`);
  }
  L.push(``);

  for (const ver of r.environment.snapdomVersions) {
    const cs = r.combos.filter((c) => c.snapdomVersion === ver);
    L.push(`## SnapDOM ${ver}: summary`, ``);
    L.push(`Verdicts per layer (A fidelity · B fiducials · C blank scan · D shader identity), aggregated over runs.`, ``);
    const cols = uniq(cs.map((c) => [c.browser, c.mode]));
    L.push(`| fixture | ${cols.map(([b, m]) => `${b} ${m}`).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
    for (const fx of uniq(cs.map((c) => c.fixture))) {
      const cells = cols.map(([b, m]) => {
        const c = cs.find((x) => x.fixture === fx && x.browser === b && x.mode === m);
        if (!c) return "–";
        return LAYERS.map((l) => `${l}:${V[c.verdict[l]]}`).join(" ") + (c.capture.fallbackRan.includes(true) ? " ⤷h2c" : "");
      });
      L.push(`| ${fx} | ${cells.join(" | ")} |`);
    }
    L.push(``, `⤷h2c = html2canvas fallback ran in at least one capture.`, ``);

    L.push(`## SnapDOM ${ver}: detail`, ``);
    for (const fx of uniq(cs.map((c) => c.fixture))) {
      L.push(`### ${fx}`, ``);
      L.push(`| browser | mode | runs | engine | fallback | captures on load | scale | A diff (runs) | A size (got / expected) | A best shift → diff | B failing markers | C blank rows / cols | C blank edges (t,b,l,r) | C content stops at (CSS px) | D lens diff (runs) |`);
      L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
      for (const c of cs.filter((x) => x.fixture === fx)) {
        const fb = c.capture.fallbackRan.includes(true) ? `ran: ${c.capture.fallbackReasons.join(", ")}` : c.capture.fallbackReasons.length ? `suppressed: ${c.capture.fallbackReasons.join(", ")}` : "no";
        const bm = c.B.failingMarkers.length
          ? c.B.failingMarkers.map((m) => `${m.name} (${m.verdict}; ${m.reason || ""}; exp ${m.expected && m.expected.slice(0, 3)} got ${m.actual ? m.actual.join(",") : "oob"})`).join("<br>")
          : `none of ${c.B.markerCount}`;
        const edges = c.C.blankEdges.map((e) => (e ? `${e.top},${e.bottom},${e.left},${e.right}` : "–")).join(" / ");
        const d = c.D.lenses.map((run) => run.map((l) => `L${l.lens} ${pct(l.diffRatio)}`).join(", ")).join(" ; ") || (c.D.reason[0] ? "n/a" : "–");
        L.push(`| ${c.browser} | ${c.mode} | ${c.runs}${c.harnessErrors.length ? ` (${c.harnessErrors.length} harness errors)` : ""} | ${c.capture.engines.join(", ")} ${c.capture.engineVersions.join(", ")} | ${fb} | ${c.capture.capturesOnLoad.join(",")} | ${c.capture.scale.map((s) => (s ? s.toFixed(4) : s)).join(", ")} | ${c.A.diffRatio.map(pct).join(", ")} → **${V[c.verdict.A]}** | ${c.A.captureSize.map((s) => s && s.join("×")).join(", ")} / ${c.A.expectedSize.map((s) => s && s.join("×")).join(", ")}${c.A.groundTruthResampled.includes(true) ? " (GT resampled)" : ""} | ${c.A.bestShift.map((s) => s && `(${s})`).join(" ")} → ${c.A.diffRatioAtBestShift.map(pct).join(", ")} | ${bm} → **${V[c.verdict.B]}** | ${c.C.blankRows.join(",")} / ${c.C.blankCols.join(",")} → **${V[c.verdict.C]}** | ${edges} | ${c.C.contentStopsAtCss.map((x) => (x === null ? "–" : x)).join(", ")} | ${d} → **${V[c.verdict.D]}** |`);
      }
      const notes = cs.filter((x) => x.fixture === fx).flatMap((c) => [
        ...c.harnessErrors.map((e) => `- ${c.browser}/${c.mode} run ${e.run} harness error: \`${e.error}\``),
        ...c.capture.captureErrors.map((e) => `- ${c.browser}/${c.mode} capture error: \`${e}\``),
        ...(c.capture.fontLoaded ? [`- ${c.browser}/${c.mode} webfont loaded (document.fonts.check): ${c.capture.fontLoaded.join(", ")}`] : []),
      ]);
      if (notes.length) L.push(``, ...notes);
      L.push(``);
    }

    L.push(`## SnapDOM ${ver}: timing (ms)`, ``);
    L.push(`Cold = the on-load capture (one per run). Warm = ${CRITERIA.timing.warmRuns} sequential \`captureSnapshot()\` calls per run, pooled over runs. \`captureMs\` covers the whole capture incl. ignore-predicate walk and bg shims; \`snapdomMs\` is the engine call only.`, ``);
    L.push(`| fixture | browser | mode | cold captureMs median (min–max, n) | cold snapdomMs median | warm captureMs median (min–max, n) | warm engine |`, `|---|---|---|---|---|---|---|`);
    for (const c of cs) L.push(`| ${c.fixture} | ${c.browser} | ${c.mode} | ${c.E.cold.median} (${c.E.cold.min}–${c.E.cold.max}, ${c.E.cold.n}) | ${c.E.snapdomMsCold.median} | ${c.E.warm.median} (${c.E.warm.min}–${c.E.warm.max}, ${c.E.warm.n}) | ${c.E.warmEngines.join(", ")} |`);
    L.push(``);

    L.push(`## SnapDOM ${ver}: artifacts`, ``);
    for (const c of cs) {
      const a = c.artifacts.find((x) => x.A);
      if (!a) continue;
      const dirn = path.dirname(a.A.capture).replace(/run\d+$/, "run*");
      L.push(`- ${c.fixture} / ${c.browser} / ${c.mode}: \`${dirn}/\` (capture.png, groundtruth.png, diff.png${a.D.length ? ", lensN-lib.png, lensN-nolib.png, lensN-diff.png" : ""})`);
    }
    L.push(``);
  }
  return L.join("\n");
}

function phase2Data(recs) {
  for (const r of recs) if (r.kind === "lab" && r.case === "tall") for (const c of r.captures) c.located = locateMarkers(c);
  const claims = evaluateClaims(recs);
  const fx = recs.filter((r) => r.kind === "fixture" && r.phase === "2");
  // Fallback triggers in production, with the raw-mode result for the same case.
  const fallbacks = [];
  for (const r of fx.filter((r) => r.mode === "production")) {
    const fb = (r.capture && r.capture.history || []).filter((h) => h.fallbackRan);
    if (!fb.length && !r.html2canvasRequested) continue;
    const raw = fx.find((x) => x.mode === "raw" && x.fixture === r.fixture && x.browser === r.browser && x.snapdomVersion === r.snapdomVersion && x.run === r.run);
    fallbacks.push({
      fixture: r.fixture, browser: r.browser, snapdomVersion: r.snapdomVersion, run: r.run,
      reasons: [...new Set(fb.map((h) => h.fallbackReason))], html2canvasRequested: r.html2canvasRequested,
      rawSameCase: raw ? { A: raw.layers.A && raw.layers.A.verdict, B: raw.layers.B && raw.layers.B.verdict, C: raw.layers.C && raw.layers.C.verdict, suppressed: [...new Set((raw.capture && raw.capture.history || []).map((h) => h.fallbackReason).filter(Boolean))], captureErrors: [...new Set((raw.capture && raw.capture.history || []).map((h) => h.error).filter(Boolean))] } : null,
    });
  }
  const suppressed = fx.filter((r) => r.mode === "raw" && (r.capture && r.capture.history || []).some((h) => h.fallbackSuppressed))
    .map((r) => ({ fixture: r.fixture, browser: r.browser, snapdomVersion: r.snapdomVersion, run: r.run, reasons: [...new Set(r.capture.history.map((h) => h.fallbackReason).filter(Boolean))] }));
  // Timing pass.
  const groups = new Map();
  for (const t of recs.filter((r) => r.kind === "timing" && !r.harnessError)) {
    const k = [t.fixture, t.mode, t.mode === "h2c" ? "html2canvas" : t.snapdomVersion, t.browser].join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const timing = [...groups.entries()].map(([k, list]) => {
    const [fixture, mode, engine, browser] = k.split("|");
    const warm = list.flatMap((t) => t.warm.map((w) => w && w.timings.captureMs));
    const warmEngine = list.flatMap((t) => t.warm.map((w) => w && w.timings.snapdomMs));
    return { fixture, mode, engine, browser, runs: list.length, cold: stats(list.map((t) => t.coldCaptureMs)), warm: stats(warm), warmSnapdomMs: stats(warmEngine), engines: [...new Set(list.flatMap((t) => t.warm.map((w) => w && w.engine)))] };
  }).sort((a, b) => [a.fixture, a.mode, a.engine, a.browser].join().localeCompare([b.fixture, b.mode, b.engine, b.browser].join()));
  return { claims, fallbacks, suppressed, timing };
}

function phase2Markdown(p) {
  const L = [`# Phase 2: claims × SnapDOM version × browser`, ``, `Criteria: \`tests/claims.md\`. Verdicts per claim from ≥ 3 runs; "reproduced" = the claim as stated was observed. Mode per claim as defined in claims.md.`, ``];
  const summary = (c) => { const n = {}; c.rows.forEach((r) => (n[r.verdict] = (n[r.verdict] || 0) + 1)); return Object.entries(n).map(([k, v]) => `${k} ${v}`).join(", "); };
  L.push(`## Summary`, ``, `| claim | verdict counts over version × browser cells |`, `|---|---|`);
  for (const c of p.claims) L.push(`| ${c.id} ${c.title} | ${summary(c)} |`);
  L.push(``);
  for (const c of p.claims) {
    L.push(`## ${c.id}: ${c.title}`, ``, `| version | browser | runs | verdict | key metrics | artifacts |`, `|---|---|---|---|---|---|`);
    for (const r of c.rows) L.push(`| ${r.version} | ${r.browser} | ${r.runs} | **${r.verdict}**${r.note ? ` (${r.note})` : ""} | ${r.metrics.join("<br>").replace(/\|/g, "\\|") || "–"} | ${r.artifacts.map((a) => `\`${a}\``).join("<br>") || "–"} |`);
    L.push(``);
  }
  L.push(`## Fallback triggers (production mode)`, ``);
  if (!p.fallbacks.length) L.push(`The html2canvas fallback did not run, and html2canvas was not requested, in any production-mode run of any fixture, version or browser.`);
  else {
    L.push(`| fixture | version | browser | run | reasons | h2c requested | raw mode, same case (A/B/C; suppressed reasons; errors) |`, `|---|---|---|---|---|---|---|`);
    for (const f of p.fallbacks) L.push(`| ${f.fixture} | ${f.snapdomVersion} | ${f.browser} | ${f.run} | ${f.reasons.join(", ")} | ${f.html2canvasRequested} | ${f.rawSameCase ? `${f.rawSameCase.A}/${f.rawSameCase.B}/${f.rawSameCase.C}; ${f.rawSameCase.suppressed.join(", ") || "none"}; ${f.rawSameCase.captureErrors.join(", ") || "none"}` : "no raw record"} |`);
  }
  L.push(``, `Raw-mode captures where the fallback *would* have run (suppressed): ${p.suppressed.length ? "" : "none."}`);
  for (const s of p.suppressed) L.push(`- ${s.fixture} / ${s.snapdomVersion} / ${s.browser} / run ${s.run}: ${s.reasons.join(", ")}`);
  L.push(``, `## Timing (serial timing pass)`, ``, `captureMs = whole capture incl. ignore walk and bg shim; snapdomMs = the engine call only. Cold = on-load capture (n = runs); warm = 5 sequential captures per run, pooled.`, ``);
  L.push(`| fixture | mode | engine | browser | runs | cold captureMs median (min–max) | warm captureMs median (min–max, n) | warm snapdomMs median |`, `|---|---|---|---|---|---|---|---|`);
  for (const t of p.timing) L.push(`| ${t.fixture} | ${t.mode} | ${t.engine} | ${t.browser} | ${t.runs} | ${t.cold.median} (${t.cold.min}–${t.cold.max}) | ${t.warm.median} (${t.warm.min}–${t.warm.max}, ${t.warm.n}) | ${t.warmSnapdomMs.median ?? "–"} |`);
  L.push(``);
  return L.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("report.mjs")) buildReport().then(() => console.log("report written"));
