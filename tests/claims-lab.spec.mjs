// Direct SnapDOM measurements for element-level claims (tests/claims.md:
// C05, C06, C07, C08, C09, C12a, C14, C16).
import { test, expect } from "@playwright/test";
import path from "node:path";
import { decodeDataUrl, fiducials, sampleMedian, parseColor, blankScan, writePng, round2 } from "./lib/measure.mjs";
import { guardNetwork } from "./lib/page.mjs";
import { artifactDir, writeRecord, rel } from "./lib/record.mjs";

const VERSIONS = (process.env.GLASS_SNAPDOM || "2.9.0,2.24.15,3.1.0").split(",");
const CASES = [
  { case: "offscreen-div" }, { case: "offscreen-img" }, { case: "offscreen-svg" }, { case: "offscreen-canvas" },
  { case: "tall", h: 20000, scale: "lib" }, { case: "tall", h: 20000, scale: "1" },
  { case: "tall", h: 40000, scale: "lib" }, { case: "tall", h: 40000, scale: "1" },
  { case: "repro" }, { case: "hook" }, { case: "filter" }, { case: "transform" },
];

const ENABLED = process.env.GLASS_PHASE === "2" && (process.env.GLASS_PASS || "verdict") === "verdict";
if (ENABLED) for (const version of VERSIONS)
  for (const c of CASES) {
    const id = [c.case, c.h, c.scale && `scale-${c.scale}`].filter(Boolean).join("-");
    test(`lab | ${id} | snapdom ${version}`, async ({ page, browserName }, testInfo) => {
      const run = testInfo.repeatEachIndex;
      const dir = artifactDir(browserName, `snapdom-${version}`, "lab", id, `run${run}`);
      const rec = { kind: "lab", case: c.case, id, params: c, browser: browserName, snapdomVersion: version, run, captures: [] };
      const net = await guardNetwork(page);
      try {
        const q = new URLSearchParams({ snapdom: version, case: c.case, ...(c.h ? { h: String(c.h) } : {}), ...(c.scale ? { scale: c.scale } : {}) });
        await page.goto(`/tests/fixtures/claims-lab.html?${q}`);
        const out = await page.evaluate(() => window.lab.run());
        rec.info = out.info;
        for (const cap of out.captures) {
          const { png, points, ...meta } = cap;
          const r = { ...meta };
          if (png) {
            const img = decodeDataUrl(png);
            r.artifact = rel(writePng(path.join(dir, `${cap.label}.png`), img));
            // Per-point check: standard fiducial tolerance, or an exact maxDelta when the claim states one.
            r.points = points.map((p) => {
              const actual = sampleMedian(img, p.x, p.y);
              const exp = parseColor(p.color);
              const d = actual ? Math.max(...[0, 1, 2].map((k) => Math.abs(actual[k] - exp[k]))) : null;
              const tol = p.maxDelta ?? 12;
              return { name: p.name, imagePos: [round2(p.x), round2(p.y)], cssY: p.cssY, expected: exp, actual, maxDelta: d, tolerance: tol,
                verdict: actual && d <= tol && actual[3] >= 240 ? "pass" : "fail" };
            });
            const C = blankScan(img);
            r.blank = { blankRows: C.blankRows, blankCols: C.blankCols, rows: img.height, blankRowRatio: round2(C.blankRows / img.height), edges: C.blankEdges, contentStopsAt: C.contentStopsAt };
          }
          rec.captures.push(r);
        }
      } catch (e) {
        rec.harnessError = String((e && e.stack) || e);
      }
      rec.external = net.external;
      rec.console = net.consoleMsgs.slice(0, 20);
      writeRecord(`lab__${browserName}__${version}__${id}__run${run}`, rec);
      expect(rec.harnessError, rec.harnessError).toBeUndefined();
      expect(rec.external).toEqual([]);
    });
  }
