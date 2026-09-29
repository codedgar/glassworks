// Timing-only pass (layer E): cold on-load capture + warm recaptures, no
// ground truth. Run serially (GLASS_WORKERS=1) so browsers don't compete.
import { expect } from "@playwright/test";
import { CRITERIA } from "./criteria.mjs";
import { fixtureUrl, guardNetwork, waitReady, waitQuiet } from "./page.mjs";
import { stats, round2 } from "./measure.mjs";
import { writeRecord } from "./record.mjs";

export async function timingOnly({ context, browserName, fixture, mode, version, run }) {
  const rec = { kind: "timing", fixture, mode, browser: browserName, browserVersion: context.browser().version(), snapdomVersion: version, run };
  const page = await context.newPage();
  const net = await guardNetwork(page);
  try {
    await page.goto(fixtureUrl(fixture, { mode, snapdom: version }));
    rec.ready = await waitReady(page);
    await waitQuiet(page);
    const hist = await page.evaluate(() => window.__glassworks.history);
    const first = hist.find((h) => !h.error);
    rec.cold = first ? first.timings : null;
    rec.coldEngine = first ? first.engine : null;
    rec.warm = [];
    for (let i = 0; i < CRITERIA.timing.warmRuns; i++) {
      await waitQuiet(page, 300);
      rec.warm.push(
        await page.evaluate(async () => {
          const before = window.__glassworks.history.length;
          await window.__liquidGLRenderer__.captureSnapshot();
          const ok = window.__glassworks.history.slice(before).filter((x) => !x.error);
          const last = ok[ok.length - 1];
          return last ? { engine: last.engine, fallbackRan: last.fallbackRan, timings: last.timings } : null;
        })
      );
    }
    rec.warmCaptureMs = stats(rec.warm.map((w) => w && w.timings.captureMs));
    rec.warmHideWindowMs = stats(rec.warm.map((w) => w && (w.timings.hideMs || 0) + (w.timings.bgShimMs || 0) + (w.timings.snapdomMs || 0)));
    rec.coldCaptureMs = rec.cold ? round2(rec.cold.captureMs) : null;
  } catch (e) {
    rec.harnessError = String((e && e.stack) || e);
  }
  rec.external = net.external;
  await page.close();
  writeRecord(`timing__${browserName}__${version}__${mode}__${fixture}__run${run}`, rec);
  expect(rec.harnessError, rec.harnessError).toBeUndefined();
  expect(rec.external).toEqual([]);
}
