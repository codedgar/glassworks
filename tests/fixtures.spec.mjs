// Layers A–E for every fixture × mode × SnapDOM version (× browser project).
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fidelity, fiducials, blankScan, shaderIdentity, stats, writePng, round2 } from "./lib/measure.mjs";
import { CRITERIA } from "./lib/criteria.mjs";
import { fixtureUrl, guardNetwork, waitReady, waitQuiet, geometry, readCapture, hideExcluded, groundTruth, lensShot } from "./lib/page.mjs";
import { artifactDir, writeRecord, rel } from "./lib/record.mjs";
import { timingOnly } from "./lib/timing.mjs";

const FIXTURES = [
  "baseline", "long-page", "bg-image", "absolute-overlay", "pseudo-elements",
  "fixed-sticky", "multi-lens-inflow", "webfont", "transforms",
];
const PHASE = process.env.GLASS_PHASE || "1";
// verdict: layers A–E; timing: layer E only (no ground truth), meant to run serially.
const PASS = process.env.GLASS_PASS || "verdict";

function matrix() {
  const only = process.env.GLASS_FIXTURES ? process.env.GLASS_FIXTURES.split(",") : null;
  const keep = (m) => !only || only.includes(m.fixture);
  if (PHASE === "1") {
    const modes = (process.env.GLASS_MODES || "raw,production").split(",");
    const versions = (process.env.GLASS_SNAPDOM || "2.9.0").split(",");
    return versions.flatMap((version) => FIXTURES.flatMap((fixture) => modes.map((mode) => ({ fixture, mode, version })))).filter(keep);
  }
  const V = (process.env.GLASS_SNAPDOM || "2.9.0,2.24.15,3.1.0").split(",");
  // Follow-up: outerTransforms left at snapdom's default.
  if (PHASE === "ot") return V.flatMap((version) => [...FIXTURES, "bg-variants", "clip"].map((fixture) => ({ fixture, mode: "raw-otdefault", version }))).filter(keep);
  // Layer-D isolation: border compensation x single-sample shader (2x2).
  if (PHASE === "d") return ["raw", "raw-otdefault", "raw-single", "raw-ot-single"].flatMap((mode) => [...FIXTURES, "bg-variants", "clip"].map((fixture) => ({ fixture, mode, version: "2.9.0" }))).filter(keep);
  // Phase 2 (tests/claims.md).
  const m = [];
  if (PASS === "timing") {
    for (const version of V) for (const fixture of ["baseline", "long-page"]) m.push({ fixture, mode: "raw", version });
    // html2canvas is independent of the SnapDOM version; 2.9.0 is only what the loader includes.
    for (const fixture of ["baseline", "long-page"]) m.push({ fixture, mode: "h2c", version: "2.9.0" });
    return m.filter(keep);
  }
  for (const version of V) {
    for (const fixture of [...FIXTURES, "bg-variants", "clip"]) for (const mode of ["raw", "production"]) m.push({ fixture, mode, version });
    for (const fixture of ["bg-image", "bg-variants"]) m.push({ fixture, mode: "raw-noshim", version });
  }
  for (const fixture of ["bg-variants", "clip", "baseline", "long-page"]) m.push({ fixture, mode: "h2c", version: "2.9.0" });
  return m.filter(keep);
}

for (const { fixture, mode, version } of matrix())
      test(`${fixture} | ${mode} | snapdom ${version}${PASS === "timing" ? " | timing" : ""}`, async ({ context, browserName }, testInfo) => {
        const run = testInfo.repeatEachIndex;
        const dir = artifactDir(browserName, `snapdom-${version}`, mode, fixture, `run${run}`);
        if (PASS === "timing") return timingOnly({ context, browserName, fixture, mode, version, run });
        const save = (name, img) => rel(writePng(path.join(dir, name), img));
        const rec = { kind: "fixture", pass: "verdict", phase: PHASE === "ot" || PHASE === "d" ? "2" : PHASE, fixture, mode, browser: browserName, browserVersion: context.browser().version(), snapdomVersion: version, run, layers: {}, notes: [] };

        try {
          /* ---------- page 1: library initialised ---------- */
          const page = await context.newPage();
          const net = await guardNetwork(page);
          await page.goto(fixtureUrl(fixture, { mode, snapdom: version }));
          const ready = await waitReady(page);
          rec.ready = ready;
          await waitQuiet(page);
          const geo = await geometry(page);
          const cap = await readCapture(page);
          rec.geometry = { scroll: geo.scroll, viewport: geo.viewport, dpr: geo.dpr, target: geo.target, lenses: geo.lenses };
          rec.gl = cap.gl;
          rec.capture = cap.meta && {
            engine: cap.meta.engine, engineVersion: cap.meta.engineVersion,
            fallbackRan: cap.meta.fallbackRan, fallbackReason: cap.meta.fallbackReason,
            capturesOnLoad: cap.meta.history.length, failed: cap.meta.failed, history: cap.meta.history,
          };
          if (fixture === "webfont") rec.fontLoaded = await page.evaluate(() => document.fonts.check('48px "GlassTestFont"'));

          // D (with library): eligible lens screenshots.
          const eligible = geo.lenses.filter((l) => l.inViewport && !l.underIgnored);
          const dWith = [];
          for (const l of eligible) dWith.push(await lensShot(page, l.rect));

          // E: warm recaptures.
          const warm = [];
          if (cap.meta && cap.meta.last && !cap.meta.failed) {
            for (let i = 0; i < CRITERIA.timing.warmRuns; i++) {
              await waitQuiet(page, 300);
              const t = await page.evaluate(async () => {
                const before = window.__glassworks.history.length;
                await window.__liquidGLRenderer__.captureSnapshot();
                const h = window.__glassworks.history.slice(before);
                const ok = h.filter((x) => !x.error);
                const last = ok.length ? ok[ok.length - 1] : null;
                return { ms: last ? last.timings.captureMs : null, timings: last ? last.timings : null, engine: last ? last.engine : null, errors: h.filter((x) => x.error).length };
              });
              warm.push(t);
            }
          }
          rec.flicker = await page.evaluate(() => window.__fixture.flicker);
          rec.html2canvasRequested = await page.evaluate(() =>
            performance.getEntriesByType("resource").some((e) => /html2canvas/.test(e.name))
          );
          rec.warmTimings = warm.map((w) => w.timings);
          rec.external = net.external;
          rec.console = net.consoleMsgs;
          await page.close();

          /* ---------- page 2: ground truth (library loaded, not initialised) ---------- */
          const gtPage = await context.newPage();
          const net2 = await guardNetwork(gtPage);
          await gtPage.goto(fixtureUrl(fixture, { mode: "off", snapdom: version, init: "0" }));
          await waitReady(gtPage);
          const gtGeo = await geometry(gtPage);
          const dWithout = [];
          for (const l of eligible) dWithout.push(await lensShot(gtPage, gtGeo.lenses[l.index].rect));
          rec.hiddenForGroundTruth = await hideExcluded(gtPage);
          const gt = await groundTruth(gtPage, gtGeo.target.rectDoc);
          rec.groundTruthTiles = gt.tiles;
          rec.external = rec.external.concat(net2.external);
          await gtPage.close();

          /* ---------- analysis ---------- */
          const scale = cap.meta && cap.meta.last ? cap.meta.last.scale : null;
          rec.scale = scale;
          rec.readError = cap.readError;
          if (!cap.image && cap.readError) {
            for (const L of ["A", "B", "C"]) rec.layers[L] = { verdict: "unmeasurable", reason: `capture canvas unreadable (${cap.readError})` };
          } else if (!cap.image) {
            const reason = cap.meta && cap.meta.failed ? "capture-failed" : "no-capture";
            for (const L of ["A", "B", "C"]) rec.layers[L] = { verdict: "fail", reason };
          } else {
            const [tw, th] = gtGeo.target.rectDoc.slice(2);
            const expW = Math.round(tw * scale), expH = Math.round(th * scale);
            const A = fidelity(cap.image, gt.image, { expectedW: expW, expectedH: expH });
            rec.layers.A = {
              verdict: A.verdict, diffRatio: round2(A.diffRatio * 1e4) / 1e4, diffPixels: A.diffPixels,
              captureSize: A.captureSize, expectedSize: A.expectedSize, groundTruthSize: A.groundTruthSize,
              dimOk: A.dimOk, groundTruthResampled: A.groundTruthResampled,
              bestShift: A.bestShift, diffRatioAtBestShift: round2(A.diffRatioAtBestShift * 1e4) / 1e4,
              artifacts: { capture: save("capture.png", cap.image), groundTruth: save("groundtruth.png", A.groundTruthCompared), diff: save("diff.png", A.diffImage) },
            };

            const Bc = fiducials(cap.image, geo.fiducials, scale);
            const Bg = fiducials(gt.image, gtGeo.fiducials, 1);
            const markers = Bc.markers.map((m, i) => {
              const g = Bg.markers[i];
              return { ...m, groundTruthVerdict: g.verdict, groundTruthActual: g.actual, verdict: g.verdict === "pass" ? m.verdict : "inconclusive" };
            });
            const bv = markers.some((m) => m.verdict === "fail") ? "fail" : markers.every((m) => m.verdict === "pass") ? "pass" : "inconclusive";
            rec.layers.B = { verdict: bv, markers };

            const C = blankScan(cap.image);
            C.contentStopsAtCss = C.contentStopsAt === null ? null : round2(C.contentStopsAt / scale);
            rec.layers.C = C;
          }

          const dRes = eligible.map((l, i) => {
            const D = shaderIdentity(dWith[i], dWithout[i]);
            return {
              lens: l.index, rect: l.rect.map(round2), verdict: D.verdict, diffRatio: round2(D.diffRatio * 1e4) / 1e4, diffPixels: D.diffPixels,
              artifacts: { withLib: save(`lens${l.index}-lib.png`, dWith[i]), withoutLib: save(`lens${l.index}-nolib.png`, dWithout[i]), diff: save(`lens${l.index}-diff.png`, D.diffImage) },
            };
          });
          rec.layers.D = dRes.length
            ? { verdict: dRes.every((d) => d.verdict === "pass") ? "pass" : "fail", lenses: dRes }
            : { verdict: "n/a", reason: "no lens fully in the initial viewport outside a fixed/ignored ancestor", lenses: [] };

          const first = cap.meta ? cap.meta.history.find((h) => !h.error) : null;
          rec.layers.E = {
            cold: first ? round2(first.timings.captureMs) : null,
            coldEngine: first ? first.engine : null,
            warm: warm.map((w) => round2(w.ms)),
            warmEngines: [...new Set(warm.map((w) => w.engine))],
            warmErrors: warm.reduce((s, w) => s + w.errors, 0),
            ...stats(warm.map((w) => w.ms)),
          };
        } catch (e) {
          rec.harnessError = String((e && e.stack) || e);
        }
        writeRecord(`fixture__${browserName}__${version}__${mode}__${fixture}__run${run}`, rec);

        // Harness integrity only; measurement verdicts go to the report.
        expect(rec.harnessError, rec.harnessError).toBeUndefined();
        expect(rec.external, "requests left 127.0.0.1").toEqual([]);
        expect(rec.gl && rec.gl.context, "WebGL2 context").toBe("webgl2");
      });
