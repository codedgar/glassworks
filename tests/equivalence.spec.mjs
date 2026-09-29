// Test-hook inertness: turning window.GLASSWORKS_TEST on must not change a
// single pixel of the snapshot texture or the WebGL output. Two loads with the
// flag off are compared first, as a control for run-to-run nondeterminism.
//
// Until the capture-alignment fix this spec also asserted byte-equality with
// the library from main. That assertion is gone on purpose: the fix changes
// the output (capture is no longer offset by 1px, and the frost==0 path no
// longer averages 5 texels). The diff against main is still measured and
// recorded as `vsMain`, so the size of the intended change stays visible.
import { test, expect } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { decodeDataUrl } from "./lib/measure.mjs";
import { fixtureUrl, guardNetwork, waitReady } from "./lib/page.mjs";
import { writeRecord } from "./lib/record.mjs";

const FIXTURES = (process.env.GLASS_EQ_FIXTURES || "baseline,long-page,bg-image,absolute-overlay,pseudo-elements,fixed-sticky,multi-lens-inflow,webfont,transforms").split(",");

async function load(context, fixture, lib, mode = "off") {
  const page = await context.newPage();
  const net = await guardNetwork(page);
  await page.goto(fixtureUrl(fixture, { mode, lib }));
  await waitReady(page);
  // No test hook when the flag is off: settle on the renderer's own state.
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__liquidGLRenderer__ && !window.__liquidGLRenderer__._capturing);
  const out = await page.evaluate(() => {
    const r = window.__liquidGLRenderer__;
    return {
      hookPresent: typeof window.__glassworks !== "undefined",
      snapshot: r.staticSnapshotCanvas ? r.staticSnapshotCanvas.toDataURL("image/png") : null,
      webgl: r.canvas.toDataURL("image/png"),
      engine: r._engine,
      textureSize: [r.textureWidth, r.textureHeight],
    };
  });
  await page.close();
  return { ...out, external: net.external };
}

function exactDiff(a, b) {
  if (!a || !b) return { comparable: false };
  const A = decodeDataUrl(a), B = decodeDataUrl(b);
  if (A.width !== B.width || A.height !== B.height) return { comparable: false, sizes: [[A.width, A.height], [B.width, B.height]] };
  const n = pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0, includeAA: true });
  return { comparable: true, diffPixels: n, size: [A.width, A.height] };
}

for (const fixture of FIXTURES)
  test(`test-hook inertness | ${fixture}`, async ({ context, browserName }, testInfo) => {
    const offA = await load(context, fixture, "current", "off");
    const offB = await load(context, fixture, "current", "off");
    const on = await load(context, fixture, "current", "raw");
    const control = { snapshot: exactDiff(offA.snapshot, offB.snapshot), webgl: exactDiff(offA.webgl, offB.webgl) };
    const subject = { snapshot: exactDiff(offA.snapshot, on.snapshot), webgl: exactDiff(offA.webgl, on.webgl) };
    /* Informational: how far the current library is from the one on main. */
    const main = await load(context, fixture, "main", "off");
    const vsMain = { snapshot: exactDiff(offA.snapshot, main.snapshot), webgl: exactDiff(offA.webgl, main.webgl) };

    const zero = (d) => d.comparable && d.diffPixels === 0;
    let verdict;
    if (zero(subject.snapshot) && zero(subject.webgl)) verdict = "identical";
    else if (!zero(control.snapshot) || !zero(control.webgl)) verdict = "inconclusive";
    else verdict = "different";

    const rec = {
      kind: "equivalence", fixture, browser: browserName, run: testInfo.repeatEachIndex, verdict,
      hookPresentWhenOff: offA.hookPresent, hookPresentWhenOn: on.hookPresent,
      engines: [offA.engine, on.engine], textureSizes: [offA.textureSize, on.textureSize],
      control, subject, vsMain,
    };
    writeRecord(`equivalence__${browserName}__${fixture}__run${rec.run}`, rec);
    expect(offA.hookPresent, "window.__glassworks must not exist with the flag off").toBe(false);
    expect(on.hookPresent, "window.__glassworks must exist with the flag on").toBe(true);
    expect([...offA.external, ...offB.external, ...on.external, ...main.external]).toEqual([]);
    expect(verdict, JSON.stringify({ control, subject })).not.toBe("different");
  });
