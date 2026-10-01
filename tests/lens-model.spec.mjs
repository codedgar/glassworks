// Layer M: the v2.1 lens model, at real refraction settings.
// Layer D only runs at refraction 0, so the model itself was untested.
// Criteria: tests/CRITERIA.md, "Phase 3 — lens model (layer M)".
import { test, expect } from "@playwright/test";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { decodePng, blank, writePng, round2 } from "./lib/measure.mjs";
import { guardNetwork } from "./lib/page.mjs";
import { artifactDir, writeRecord, rel } from "./lib/record.mjs";

const DEFAULTS = { refraction: "0.01", bevelDepth: "0.08" };
const RIM_FRACTION = 0.15;

async function lensShot(context, fixture, params, lensSelector = ".lens") {
  const page = await context.newPage();
  const net = await guardNetwork(page);
  await page.goto(`/tests/fixtures/${fixture}.html?${new URLSearchParams({ snapdom: "2.9.0", ...params })}`);
  await page.waitForFunction(() => window.__fixture && window.__fixture.ready, null, { timeout: 60000 });
  await page.waitForTimeout(900);
  const rect = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.ceil(r.left) + 1, y: Math.ceil(r.top) + 1, width: Math.floor(r.width) - 2, height: Math.floor(r.height) - 2 };
  }, lensSelector);
  const png = decodePng(await page.screenshot({ clip: rect }));
  await page.close();
  expect(net.external, "no external requests").toEqual([]);
  return png;
}

/** Differing pixels split by region: rim band vs interior, and per edge band. */
function regions(a, b) {
  const { width, height } = a;
  const diff = blank(width, height);
  pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1, includeAA: false });
  const band = RIM_FRACTION * Math.min(width, height);
  let rim = 0, interior = 0, rimTotal = 0, interiorTotal = 0, vert = 0, horiz = 0, vertTotal = 0, horizTotal = 0, total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = Math.min(x, width - 1 - x), dy = Math.min(y, height - 1 - y);
      const isRim = Math.min(dx, dy) < band;
      const isVertBand = dx < band && dy >= band;   // left / right edges
      const isHorizBand = dy < band && dx >= band;  // top / bottom edges
      if (isRim) rimTotal++; else interiorTotal++;
      if (isVertBand) vertTotal++;
      if (isHorizBand) horizTotal++;
      const differs = diff.data[i] > 200 && diff.data[i + 1] < 100;
      if (differs) {
        total++;
        if (isRim) rim++; else interior++;
        if (isVertBand) vert++;
        if (isHorizBand) horiz++;
      }
    }
  }
  return {
    diffImage: diff, size: [width, height], total,
    ratioAll: total / (width * height),
    ratioRim: rim / Math.max(rimTotal, 1),
    ratioInterior: interior / Math.max(interiorTotal, 1),
    rimShare: total ? rim / total : 0,
    ratioVert: vert / Math.max(vertTotal, 1),
    ratioHoriz: horiz / Math.max(horizTotal, 1),
  };
}

const pct = (x) => round2(x * 1e4) / 1e2;

test("layer M | lens model at real refraction settings", async ({ context, browserName }, testInfo) => {
  const run = testInfo.repeatEachIndex;
  const dir = artifactDir(browserName, "lens-model", `run${run}`);
  const rec = { kind: "lens-model", browser: browserName, run, checks: {} };

  /* The `lens-model` fixture: square lens over a checkerboard. Isotropy
     cannot be measured on `baseline`, whose background is vertical stripes
     (a vertical shift across vertical stripes is nearly invisible) and whose
     lens is 420x260. Disclosed in the Phase 3 notes. */
  const FIXTURE = "lens-model";
  const plain = await lensShot(context, FIXTURE, { mode: "off", init: "0" });

  // M1 — identity at zero refraction.
  const zero = await lensShot(context, FIXTURE, { mode: "raw", refraction: "0", bevelDepth: "0" });
  const m1 = regions(plain, zero);
  rec.checks.M1 = { ratioAll: pct(m1.ratioAll), pass: m1.ratioAll <= 0.01 };

  // M2 / M3 / M4 — the model at shipped defaults.
  const def = await lensShot(context, FIXTURE, { mode: "raw", ...DEFAULTS });
  const m = regions(plain, def);
  rec.checks.M2 = { interiorPct: pct(m.ratioInterior), pass: m.ratioInterior <= 0.02 };
  rec.checks.M3 = { rimPct: pct(m.ratioRim), pass: m.ratioRim >= 0.03 };
  const iso = m.ratioHoriz > 0 ? m.ratioVert / m.ratioHoriz : Infinity;
  rec.checks.M4 = { vertPct: pct(m.ratioVert), horizPct: pct(m.ratioHoriz), ratio: round2(iso), pass: iso >= 0.5 && iso <= 2.0 };
  rec.artifacts = {
    plain: rel(writePng(path.join(dir, "no-lens.png"), plain)),
    defaults: rel(writePng(path.join(dir, "defaults.png"), def)),
    diff: rel(writePng(path.join(dir, "defaults-diff.png"), m.diffImage)),
  };

  // M5 / M6 — specular is rim-only and continuous.
  const spec0 = await lensShot(context, FIXTURE, { mode: "raw", ...DEFAULTS, specular: "0" });
  const spec1 = await lensShot(context, FIXTURE, { mode: "raw", ...DEFAULTS, specular: "1" });
  const specHalf = await lensShot(context, FIXTURE, { mode: "raw", ...DEFAULTS, specular: "0.5" });
  const s1 = regions(spec0, spec1);
  const sHalf = regions(spec0, specHalf);
  rec.checks.M5 = { rimShare: pct(s1.rimShare), totalPx: s1.total, pass: s1.total > 0 && s1.rimShare >= 0.8 };
  rec.checks.M6 = {
    pxAtHalf: sHalf.total, pxAtOne: s1.total,
    pass: sHalf.total > 0 && s1.total > 0 && sHalf.total < s1.total,
  };
  rec.artifacts.specularDiff = rel(writePng(path.join(dir, "specular-diff.png"), s1.diffImage));

  writeRecord(`lensmodel__${browserName}__run${run}`, rec);
  for (const [id, c] of Object.entries(rec.checks)) {
    expect(c.pass, `${id}: ${JSON.stringify(c)}`).toBe(true);
  }
});
