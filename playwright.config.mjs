// Glassworks verification harness. Run with `npm run test:glass`.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.GLASS_PORT || 4173);
const DSF = Number(process.env.GLASS_DSF || 1);
const common = {
  baseURL: `http://127.0.0.1:${PORT}`,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: DSF,
  colorScheme: "light",
  reducedMotion: "reduce",
  serviceWorkers: "block",
};

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.mjs$/,
  outputDir: "test-results/pw",
  timeout: 240000,
  fullyParallel: false,
  workers: Number(process.env.GLASS_WORKERS || 1), // serial: keeps timings comparable
  repeatEach: Number(process.env.GLASS_RUNS || 3),
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.mjs",
  globalTeardown: "./tests/global-teardown.mjs",
  webServer: {
    command: `node tests/server.mjs`,
    url: `http://127.0.0.1:${PORT}/package.json`,
    reuseExistingServer: false,
    env: { GLASS_PORT: String(PORT) },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...common,
        browserName: "chromium",
        launchOptions: {
          // Headless Chromium has no GPU: force WebGL through SwiftShader.
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-features=WebGPU"],
        },
      },
    },
    {
      name: "firefox",
      use: {
        ...common,
        browserName: "firefox",
        launchOptions: {
          firefoxUserPrefs: { "webgl.force-enabled": true, "webgl.disabled": false, "dom.webgpu.enabled": false },
        },
      },
    },
    { name: "webkit", use: { ...common, browserName: "webkit" } },
  ],
});
