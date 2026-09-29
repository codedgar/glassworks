// Negative controls: deliberately broken inputs the harness MUST flag as
// failures. If any of these "pass", the harness cannot detect problems and
// the Playwright run fails. Positive controls (ground truth vs itself) must
// pass, otherwise the layer is broken in the other direction.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fidelity, fiducials, blankScan, shaderIdentity, shift, writePng, round2 } from "./lib/measure.mjs";
import { fixtureUrl, guardNetwork, waitReady, waitQuiet, geometry, readCapture, hideExcluded, groundTruth, lensShot } from "./lib/page.mjs";
import { artifactDir, writeRecord, rel } from "./lib/record.mjs";

const OFFSET = 24; // px; well above any tolerance

test("negative control | baseline", async ({ context, browserName }, testInfo) => {
  const run = testInfo.repeatEachIndex;
  const dir = artifactDir(browserName, "negative-control", `run${run}`);
  const save = (n, img) => rel(writePng(path.join(dir, n), img));
  const checks = [];
  const add = (name, expected, verdict, metric) => checks.push({ name, expected, verdict, detected: verdict === expected, metric });

  // Ground truth for baseline.
  const gtPage = await context.newPage();
  await guardNetwork(gtPage);
  await gtPage.goto(fixtureUrl("baseline", { mode: "off", init: "0" }));
  await waitReady(gtPage);
  const geo = await geometry(gtPage);
  const lens = geo.lenses[0];
  const lensNoLib = await lensShot(gtPage, lens.rect);
  await hideExcluded(gtPage);
  const gt = (await groundTruth(gtPage, geo.target.rectDoc)).image;
  await gtPage.close();

  // Positive controls.
  const posA = fidelity(gt, gt);
  add("A positive: ground truth vs itself", "pass", posA.verdict, { diffRatio: posA.diffRatio });
  const posB = fiducials(gt, geo.fiducials, 1);
  add("B positive: markers on ground truth", "pass", posB.verdict, { failing: posB.markers.filter((m) => m.verdict !== "pass").map((m) => m.name) });
  const posC = blankScan(gt);
  add("C positive: ground truth has no blank rows/cols", "pass", posC.verdict, { blankRows: posC.blankRows, blankCols: posC.blankCols });

  // A: ground truth shifted by OFFSET px must fail fidelity.
  const shifted = shift(gt, OFFSET, OFFSET);
  save("gt-shifted.png", shifted);
  const negA = fidelity(shifted, gt);
  add(`A negative: capture offset by ${OFFSET}px`, "fail", negA.verdict, { diffRatio: round2(negA.diffRatio * 1e4) / 1e4 });

  // B: markers expected at the wrong coordinates must fail.
  const wrong = geo.fiducials.map((p) => ({ ...p, x: p.x + 200, y: p.y + 7 }));
  const negB1 = fiducials(gt, wrong, 1);
  add("B negative: markers expected +200px x, +7px y", "fail", negB1.verdict, { failing: negB1.markers.filter((m) => m.verdict === "fail").length, of: negB1.markers.length });
  // B: correct coordinates on an offset capture must fail.
  const negB2 = fiducials(shifted, geo.fiducials, 1);
  add(`B negative: offset capture (${OFFSET}px)`, "fail", negB2.verdict, { failing: negB2.markers.filter((m) => m.verdict === "fail").length, of: negB2.markers.length });

  // C: clear the bottom 30% to transparent, and paint a black band.
  const cleared = shift(gt, 0, 0);
  const cut = Math.floor(gt.height * 0.7);
  cleared.data.fill(0, cut * gt.width * 4);
  for (let y = 100; y < 110; y++) for (let x = 0; x < gt.width; x++) { const i = (y * gt.width + x) * 4; cleared.data[i] = cleared.data[i + 1] = cleared.data[i + 2] = 0; cleared.data[i + 3] = 255; }
  save("gt-cleared.png", cleared);
  const negC = blankScan(cleared);
  add("C negative: bottom 30% transparent + 10 black rows", "fail", negC.verdict, { blankRows: negC.blankRows, blackRows: negC.blackRows, contentStopsAt: negC.contentStopsAt, expectedStop: cut });
  expect(negC.contentStopsAt, "contentStopsAt must equal the cleared row").toBe(cut);
  expect(negC.blackRows, "black rows").toBe(10);

  // D: a refracting lens (refraction 0.05, bevelDepth 0.2) must fail identity.
  const page = await context.newPage();
  await guardNetwork(page);
  await page.goto(fixtureUrl("baseline", { mode: "production", refraction: "0.05", bevelDepth: "0.2" }));
  await waitReady(page);
  await waitQuiet(page);
  const lensLib = await lensShot(page, lens.rect);
  const cap = await readCapture(page);
  await page.close();
  const negD = shaderIdentity(lensLib, lensNoLib);
  save("lens-refracting.png", lensLib);
  add("D negative: refraction 0.05 / bevelDepth 0.2", "fail", negD.verdict, { diffRatio: round2(negD.diffRatio * 1e4) / 1e4 });

  // A/B on the real library capture, offset by OFFSET px.
  if (cap.image) {
    const capShift = shift(cap.image, OFFSET, OFFSET);
    const s = cap.meta.last.scale;
    const negA2 = fidelity(capShift, gt, { expectedW: Math.round(gt.width * s), expectedH: Math.round(gt.height * s) });
    add(`A negative: library capture offset by ${OFFSET}px`, "fail", negA2.verdict, { diffRatio: round2(negA2.diffRatio * 1e4) / 1e4 });
    const negB3 = fiducials(capShift, geo.fiducials, s);
    add(`B negative: library capture offset by ${OFFSET}px`, "fail", negB3.verdict, { failing: negB3.markers.filter((m) => m.verdict === "fail").length, of: negB3.markers.length });
  } else {
    add("A/B negative on library capture", "fail", "no-capture", {});
  }

  writeRecord(`negative__${browserName}__run${run}`, { kind: "negative-control", browser: browserName, run, checks });
  for (const c of checks) expect(c.verdict, c.name).toBe(c.expected);
});

// Ground-truth tiling control: tall targets are stitched from clip tiles.
// Where a single full-page screenshot works, the two must be identical.
test("ground-truth tiling control | long-page", async ({ context, browserName }, testInfo) => {
  const page = await context.newPage();
  await guardNetwork(page);
  await page.goto(fixtureUrl("long-page", { mode: "off", init: "0" }));
  await waitReady(page);
  const geo = await geometry(page);
  await hideExcluded(page);
  const tiled = await groundTruth(page, geo.target.rectDoc);
  let single = null, singleError = null;
  try {
    const { decodePng, crop } = await import("./lib/measure.mjs");
    const full = decodePng(await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" }));
    const [x, y, w, h] = geo.target.rectDoc.map(Math.round);
    single = crop(full, x, y, w, h);
  } catch (e) {
    singleError = String(e.message || e).split("\n")[0];
  }
  await page.close();
  const tiledFid = fiducials(tiled.image, geo.fiducials, 1);
  let diffRatio = null;
  if (single) diffRatio = fidelity(tiled.image, single).diffRatio;
  writeRecord(`tiling__${browserName}__run${testInfo.repeatEachIndex}`, {
    kind: "tiling-control", browser: browserName, run: testInfo.repeatEachIndex, tiles: tiled.tiles,
    tiledFiducials: tiledFid.verdict, failing: tiledFid.markers.filter((m) => m.verdict !== "pass").map((m) => m.name),
    singleShotError: singleError, diffRatioTiledVsSingle: diffRatio,
  });
  expect(tiledFid.verdict, "all long-page markers found in tiled ground truth").toBe("pass");
  if (single) expect(diffRatio, "tiled vs single-shot ground truth").toBe(0);
});
