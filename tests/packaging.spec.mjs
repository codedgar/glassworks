// Packaging behaviour: engine injection, loud failure, and the build outputs.
import { test, expect } from "@playwright/test";
import { guardNetwork } from "./lib/page.mjs";
import { writeRecord } from "./lib/record.mjs";

const settle = (page, ms = 4000) => page.waitForTimeout(ms);

test("no engine fails loudly and keeps the lens visible", async ({ page, browserName }) => {
  const net = await guardNetwork(page);
  await page.goto("/tests/packaging/no-engine.html", { waitUntil: "load" });
  await settle(page);
  const r = await page.evaluate(() => ({
    errors: window.__errors,
    inited: window.__inited,
    lensOpacity: getComputedStyle(document.querySelector(".lens")).opacity,
    rendererExists: !!window.__liquidGLRenderer__,
    textureCreated: !!(window.__liquidGLRenderer__ && window.__liquidGLRenderer__.texture),
  }));
  writeRecord(`packaging__${browserName}__no-engine`, { kind: "packaging", case: "no-engine", browser: browserName, ...r, external: net.external });
  // The old behaviour: silent, lens stuck at opacity 0. The new behaviour:
  const msg = r.errors.join("\n");
  expect(msg, "an actionable error is logged").toContain("no capture engine available");
  expect(msg).toContain("registerEngine");
  expect(Number(r.lensOpacity), "lens is not left invisible").toBeGreaterThan(0);
  expect(r.inited, "on.init still fires so callers are not left hanging").toBe(true);
});

test("engine: html2canvas works without snapdom present", async ({ page, browserName }) => {
  await guardNetwork(page);
  await page.goto("/tests/packaging/h2c-only.html", { waitUntil: "load" });
  await settle(page, 6000);
  const r = await page.evaluate(() => ({
    inited: window.__inited,
    snapdom: typeof window.snapdom,
    html2canvas: typeof window.html2canvas,
    textureCreated: !!(window.__liquidGLRenderer__ && window.__liquidGLRenderer__.texture),
    lensOpacity: getComputedStyle(document.querySelector(".lens")).opacity,
  }));
  writeRecord(`packaging__${browserName}__h2c-only`, { kind: "packaging", case: "h2c-only", browser: browserName, ...r });
  expect(r.snapdom).toBe("undefined");
  expect(r.html2canvas).toBe("function");
  expect(r.textureCreated, "capture happened via html2canvas").toBe(true);
  expect(r.inited).toBe(true);
});

test("ESM import with an injected adapter, no globals", async ({ page, browserName }) => {
  await guardNetwork(page);
  await page.goto("/tests/packaging/esm-adapter.html", { waitUntil: "load" });
  await settle(page, 6000);
  const r = await page.evaluate(() => ({
    version: window.__version,
    globalsSeen: window.__globalsSeen,
    engineInfo: window.__engineInfo,
    inited: window.__inited,
    textureCreated: !!(window.__liquidGLRenderer__ && window.__liquidGLRenderer__.texture),
    textureSize: window.__liquidGLRenderer__ ? [window.__liquidGLRenderer__.textureWidth, window.__liquidGLRenderer__.textureHeight] : null,
  }));
  writeRecord(`packaging__${browserName}__esm-adapter`, { kind: "packaging", case: "esm-adapter", browser: browserName, ...r });
  expect(r.globalsSeen.snapdom, "no snapdom global was needed").toBe("undefined");
  expect(r.globalsSeen.glassworks, "ESM build does not touch window").toBe("undefined");
  expect(r.engineInfo.name).toBe("snapdom");
  expect(r.textureCreated, "capture happened through the injected adapter").toBe(true);
  expect(r.inited).toBe(true);
});

test("UMD build keeps window.liquidGL and adds window.glassworks", async ({ page, browserName }) => {
  await guardNetwork(page);
  await page.goto("/tests/fixtures/baseline.html?mode=raw&snapdom=3.1.0", { waitUntil: "load" });
  const r = await page.evaluate(() => ({
    glassworks: typeof window.glassworks,
    liquidGL: typeof window.liquidGL,
    same: window.glassworks === window.liquidGL,
    hasRegisterEngine: typeof window.glassworks.registerEngine,
    hasCreateSnapdom: typeof window.glassworks.createSnapdomEngine,
    hasRegisterDynamic: typeof window.liquidGL.registerDynamic,
    hasSyncWith: typeof window.liquidGL.syncWith,
    version: window.glassworks.version,
  }));
  writeRecord(`packaging__${browserName}__umd-globals`, { kind: "packaging", case: "umd-globals", browser: browserName, ...r });
  expect(r.glassworks).toBe("function");
  expect(r.liquidGL).toBe("function");
  expect(r.same, "liquidGL is an alias of glassworks").toBe(true);
  expect(r.hasRegisterEngine).toBe("function");
  expect(r.hasRegisterDynamic).toBe("function");
  expect(r.hasSyncWith).toBe("function");
});
