// Real-page benchmark: Glassworks' own pages and the Puppertino 2.0 docs,
// vendored locally by tests/realpages/build.mjs.
//   GLASS_REAL=timing       capture timing per engine (serial)
//   GLASS_REAL=correctness  layers A / B / C per SnapDOM version
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fidelity, fiducials, blankScan, stats, writePng, round2 } from "./lib/measure.mjs";
import { CRITERIA } from "./lib/criteria.mjs";
import { guardNetwork, waitReady, waitQuiet, geometry, readCapture, hideExcluded, groundTruth } from "./lib/page.mjs";
import { artifactDir, writeRecord, rel } from "./lib/record.mjs";

const SUITE = process.env.GLASS_REAL || "";
const VERSIONS = (process.env.GLASS_SNAPDOM || "2.9.0,2.24.15,3.1.0").split(",");

// Glassworks' own pages run their real liquidGL() call; they animate (GSAP,
// Lenis), so layer A is not comparable against a static screenshot for them.
const GW = ["index.html", "demos_demo-1.html", "demos_demo-2.html", "demos_demo-3.html", "demos_demo-4.html", "demos_demo-5.html", "demos_comparison-scene.html"]
  .map((f) => ({ id: `gw:${f}`, url: `/tests/realpages/glassworks/${f}`, animated: true }));
// Puppertino docs: static pages, lenses attached by the harness.
// examples/index.html is a 382-byte meta-refresh redirect stub, not a page.
const PUP = ["index.html", "docs/index.html", "docs/materials/index.html", "docs/colors/index.html", "docs/typography/index.html", "docs/foundations/index.html", "docs/getting-started/index.html"]
  .map((f) => ({ id: `pup:${f}`, url: `/tests/realpages/puppertino/${f}`, animated: false }));
const PAGES = [...GW, ...PUP];
const TIMING_PAGES = [GW[0], GW[1], GW[2], GW[5], PUP[0], PUP[1], PUP[2], PUP[3]];

const url = (p, params) => `${p.url}?${new URLSearchParams(params)}`;

/* ---------------- timing suite ---------------- */
if (SUITE === "timing")
  for (const engine of [...VERSIONS.map((v) => ({ mode: "raw", version: v, label: `snapdom ${v}` })), { mode: "h2c", version: "2.9.0", label: "html2canvas 1.4.1" }])
    for (const p of TIMING_PAGES)
      test(`timing | ${p.id} | ${engine.label}`, async ({ context, browserName }, testInfo) => {
        const rec = { kind: "real-timing", page: p.id, engine: engine.label, mode: engine.mode, snapdomVersion: engine.version, browser: browserName, browserVersion: context.browser().version(), run: testInfo.repeatEachIndex };
        const page = await context.newPage();
        const net = await guardNetwork(page);
        try {
          await page.goto(url(p, { mode: engine.mode, snapdom: engine.version }), { waitUntil: "load" });
          await waitReady(page, 90000);
          rec.fixture = await page.evaluate(() => ({ ownInit: window.__fixture.ownInit, lensCount: window.__fixture.lensCount, attached: window.__fixture.attached, error: window.__fixture.error }));
          await waitQuiet(page, 800, 60000);
          const first = await page.evaluate(() => {
            const g = window.__glassworks;
            const h = g ? g.history.filter((x) => !x.error) : [];
            return { cold: h[0] ? h[0].timings : null, engine: h[0] ? h[0].engine : null, captures: g ? g.history.length : 0, pageH: document.body.scrollHeight, scale: h[0] ? h[0].scale : null, size: h[0] ? [h[0].width, h[0].height] : null, fallback: g ? g.history.map((x) => x.fallbackReason).filter(Boolean) : [] };
          });
          Object.assign(rec, first);
          rec.warm = [];
          for (let i = 0; i < CRITERIA.timing.warmRuns; i++) {
            await waitQuiet(page, 300, 60000);
            rec.warm.push(await page.evaluate(async () => {
              const before = window.__glassworks.history.length;
              await window.__liquidGLRenderer__.captureSnapshot();
              const ok = window.__glassworks.history.slice(before).filter((x) => !x.error);
              const last = ok[ok.length - 1];
              return last ? { ms: last.timings.captureMs, engineMs: last.timings.snapdomMs ?? null, engine: last.engine } : null;
            }));
          }
          rec.warmCaptureMs = stats(rec.warm.map((w) => w && w.ms));
          rec.coldCaptureMs = rec.cold ? round2(rec.cold.captureMs) : null;
        } catch (e) {
          rec.harnessError = String((e && e.stack) || e);
        }
        rec.external = net.external;
        await page.close();
        writeRecord(`realtiming__${browserName}__${engine.label.replace(/[^\w.]+/g, "_")}__${p.id.replace(/[^\w.]+/g, "_")}__run${rec.run}`, rec);
        expect(rec.harnessError, rec.harnessError).toBeUndefined();
        expect(rec.external).toEqual([]);
      });

/* ---------------- correctness suite ---------------- */
if (SUITE === "correctness")
  for (const version of VERSIONS)
    for (const p of PAGES)
      test(`correctness | ${p.id} | snapdom ${version}`, async ({ context, browserName }, testInfo) => {
        const run = testInfo.repeatEachIndex;
        const dir = artifactDir(browserName, `snapdom-${version}`, "realpage", p.id.replace(/[^\w.]+/g, "_"), `run${run}`);
        const save = (n, img) => rel(writePng(path.join(dir, n), img));
        const rec = { kind: "real-correctness", page: p.id, animated: p.animated, browser: browserName, snapdomVersion: version, run, layers: {} };
        try {
          /* variant 1: page as-is -> layers A (static pages only) and C */
          const page = await context.newPage();
          const net = await guardNetwork(page);
          await page.goto(url(p, { mode: "raw", snapdom: version }), { waitUntil: "load" });
          await waitReady(page, 90000);
          await waitQuiet(page, 800, 60000);
          const geo = await geometry(page);
          const cap = await readCapture(page);
          rec.fixture = await page.evaluate(() => ({ ownInit: window.__fixture.ownInit, lensCount: window.__fixture.lensCount, attached: window.__fixture.attached, flicker: window.__fixture.flicker }));
          rec.capture = cap.meta && { engine: cap.meta.engine, fallbackRan: cap.meta.fallbackRan, fallbackReason: cap.meta.fallbackReason, captures: cap.meta.history.length, errors: cap.meta.history.map((h) => h.error).filter(Boolean) };
          rec.scale = cap.meta && cap.meta.last ? cap.meta.last.scale : null;
          rec.pageSize = geo.target.rectDoc.slice(2);
          rec.external = net.external;
          await page.close();

          if (cap.image) {
            const C = blankScan(cap.image);
            C.contentStopsAtCss = C.contentStopsAt === null ? null : round2(C.contentStopsAt / rec.scale);
            rec.layers.C = { ...C, artifact: save("capture.png", cap.image) };
          } else {
            rec.layers.C = { verdict: cap.readError ? "unmeasurable" : "fail", reason: cap.readError || "no capture" };
          }

          if (!p.animated && cap.image) {
            const gt = await context.newPage();
            await guardNetwork(gt);
            await gt.goto(url(p, { mode: "off", snapdom: version, init: "0" }), { waitUntil: "load" });
            await waitReady(gt, 90000);
            const gtGeo = await geometry(gt);
            await hideExcluded(gt);
            const truth = await groundTruth(gt, gtGeo.target.rectDoc);
            await gt.close();
            const [tw, th] = gtGeo.target.rectDoc.slice(2);
            const A = fidelity(cap.image, truth.image, { expectedW: Math.round(tw * rec.scale), expectedH: Math.round(th * rec.scale) });
            rec.layers.A = { verdict: A.verdict, diffRatio: round2(A.diffRatio * 1e4) / 1e4, diffPixels: A.diffPixels, captureSize: A.captureSize, expectedSize: A.expectedSize, bestShift: A.bestShift, diffRatioAtBestShift: round2(A.diffRatioAtBestShift * 1e4) / 1e4, groundTruthResampled: A.groundTruthResampled, artifacts: { groundTruth: save("groundtruth.png", A.groundTruthCompared), diff: save("diff.png", A.diffImage) } };
          } else {
            rec.layers.A = { verdict: "n/a", reason: p.animated ? "page animates (GSAP/Lenis): no static ground truth" : "no capture" };
          }

          /* variant 2: markers injected -> layer B */
          const mp = await context.newPage();
          await guardNetwork(mp);
          await mp.goto(url(p, { mode: "raw", snapdom: version, markers: "1" }), { waitUntil: "load" });
          await waitReady(mp, 90000);
          await waitQuiet(mp, 800, 60000);
          const mgeo = await geometry(mp);
          const mcap = await readCapture(mp);
          await mp.close();
          if (mcap.image && mgeo.fiducials.length) {
            const B = fiducials(mcap.image, mgeo.fiducials, mcap.meta.last.scale);
            rec.layers.B = { verdict: B.verdict, markers: B.markers, artifact: save("capture-markers.png", mcap.image) };
          } else {
            rec.layers.B = { verdict: "inconclusive", reason: mcap.readError || "no capture or no markers" };
          }
        } catch (e) {
          rec.harnessError = String((e && e.stack) || e);
        }
        writeRecord(`realcorrect__${browserName}__${version}__${p.id.replace(/[^\w.]+/g, "_")}__run${run}`, rec);
        expect(rec.harnessError, rec.harnessError).toBeUndefined();
      });
