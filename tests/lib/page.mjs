// Page-side helpers: loading fixtures, waiting deterministically, pulling
// the raw capture out of window.__glassworks, and producing ground truth.
import { decodePng, decodeDataUrl } from "./measure.mjs";

export const DEFAULT_SNAPDOM = "2.9.0";

export function fixtureUrl(fixture, params = {}) {
  const q = new URLSearchParams({ snapdom: DEFAULT_SNAPDOM, ...params });
  return `/tests/fixtures/${fixture}.html?${q}`;
}

/** Abort anything not served by the local harness server and record it. */
export async function guardNetwork(page) {
  const external = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === "data:" || u.protocol === "blob:" || u.hostname === "127.0.0.1") {
      return route.continue();
    }
    external.push(route.request().url());
    return route.abort();
  });
  const consoleMsgs = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
  return { external, consoleMsgs };
}

/** Wait for fixture ready (all lens on.init fired) or a hard capture failure. */
export async function waitReady(page, timeout = 60000) {
  await page.waitForFunction(
    () =>
      window.__fixture &&
      (window.__fixture.ready ||
        window.__fixture.error ||
        (window.__glassworks && window.__glassworks.failed)),
    null,
    { timeout }
  );
  return page.evaluate(() => ({
    ready: window.__fixture.ready,
    error: window.__fixture.error,
    failed: !!(window.__glassworks && window.__glassworks.failed),
  }));
}

/** Wait until no capture is in flight and the capture count has been
 *  stable for `quietMs` (the library's ResizeObserver can schedule a second
 *  capture ~250ms after init). */
export async function waitQuiet(page, quietMs = 800, timeout = 30000) {
  const start = Date.now();
  let last = -1, since = Date.now();
  while (Date.now() - start < timeout) {
    const s = await page.evaluate(() => {
      const g = window.__glassworks;
      return g ? { n: g.history.length, busy: g.capturing } : { n: 0, busy: false };
    });
    if (s.busy || s.n !== last) {
      last = s.n;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return;
    await page.waitForTimeout(100);
  }
  throw new Error("waitQuiet: captures never settled");
}

/** Geometry shared by capture and ground-truth analysis. */
export async function geometry(page) {
  return page.evaluate(() => {
    /* Coordinates must be relative to the element the library actually
       captured (pages may pass snapshot: ".main-content"), not always body. */
    const r = window.__liquidGLRenderer__;
    const target = (r && r.snapshotTarget) || document.body;
    const t = target.getBoundingClientRect();
    const fid = [];
    document.querySelectorAll("[data-fid]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const base = el.getAttribute("data-fid");
      const pts = el.getAttribute("data-fid-points");
      if (pts) {
        JSON.parse(pts).forEach((p) =>
          fid.push({ name: `${base}.${p.name}`, x: r.left - t.left + p.x, y: r.top - t.top + p.y, color: p.color })
        );
      } else {
        fid.push({
          name: base,
          x: r.left - t.left + r.width / 2,
          y: r.top - t.top + r.height / 2,
          color: el.getAttribute("data-fid-color") || getComputedStyle(el).backgroundColor,
        });
      }
    });
    const sel = (window.__fixture && window.__fixture.target) || ".lens";
    const lenses = Array.from(document.querySelectorAll(sel)).map((el, i) => {
      const r = el.getBoundingClientRect();
      let n = el.parentElement, underIgnored = false;
      while (n && n !== document.body) {
        if (getComputedStyle(n).position === "fixed" || n.hasAttribute("data-liquid-ignore")) underIgnored = true;
        n = n.parentElement;
      }
      const inViewport = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      return { index: i, rect: [r.left, r.top, r.width, r.height], inViewport, underIgnored };
    });
    return {
      scroll: [scrollX, scrollY],
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      target: { rectDoc: [t.left + scrollX, t.top + scrollY, t.width, t.height], scrollW: target.scrollWidth, scrollH: target.scrollHeight, selector: target === document.body ? "body" : (target.className || target.tagName) },
      fiducials: fid,
      lenses,
    };
  });
}

/** Pull the raw capture + metadata from the test hook. */
export async function readCapture(page) {
  const r = await page.evaluate(() => {
    const g = window.__glassworks;
    const rend = window.__liquidGLRenderer__;
    let png = null, readError = null;
    if (g && g.canvas) {
      try {
        let c = g.canvas;
        if (typeof c.toDataURL !== "function") {
          const tmp = document.createElement("canvas");
          tmp.width = c.width; tmp.height = c.height;
          tmp.getContext("2d").drawImage(c, 0, 0);
          c = tmp;
        }
        png = c.toDataURL("image/png");
      } catch (e) {
        // e.g. a tainted canvas: the capture exists but its pixels can't be read.
        readError = `${e.name}: ${e.message}`;
      }
    }
    const gl = rend && rend.gl;
    return {
      png,
      readError,
      meta: g
        ? {
            mode: g.mode, captureCount: g.captureCount, failed: g.failed,
            engine: g.engine, engineVersion: g.engineVersion,
            fallbackRan: g.fallbackRan, fallbackReason: g.fallbackReason,
            timings: g.timings, last: g.last, history: g.history,
          }
        : null,
      gl: gl
        ? {
            context: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1",
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          }
        : null,
    };
  });
  return { ...r, image: r.png ? decodeDataUrl(r.png) : null };
}

/** Mirror the library's ignore predicate on the live page (visibility only,
 *  so layout is untouched): lens elements, position:fixed elements, and
 *  [data-liquid-ignore] subtrees. */
export async function hideExcluded(page) {
  return page.evaluate(() => {
    const sel = (window.__fixture && window.__fixture.target) || ".lens";
    const lenses = new Set(document.querySelectorAll(sel));
    let n = 0;
    document.body.querySelectorAll("*").forEach((el) => {
      if (
        lenses.has(el) ||
        getComputedStyle(el).position === "fixed" ||
        el.closest("[data-liquid-ignore]")
      ) {
        el.style.setProperty("visibility", "hidden", "important");
        n++;
      }
    });
    return n;
  });
}

/** Full-page screenshot cropped to the snapshot target. */
export const GT_TILE = 2000; // px; tall targets are stitched from full-page clip tiles
export async function groundTruth(page, targetRectDoc) {
  const [x, y, w, h] = targetRectDoc.map(Math.round);
  const { crop, blank } = await import("./measure.mjs");
  const opts = { fullPage: true, animations: "disabled", caret: "hide" };
  if (h <= GT_TILE) {
    const full = decodePng(await page.screenshot(opts));
    return { image: crop(full, x, y, w, h), fullSize: [full.width, full.height], tiles: 1 };
  }
  // Chromium (SwiftShader) cannot capture an ~11.6k px full-page screenshot in
  // one shot, so every browser uses the same tiling for tall targets.
  const out = blank(w, h);
  let tiles = 0;
  for (let ty = 0; ty < h; ty += GT_TILE) {
    const th = Math.min(GT_TILE, h - ty);
    const tile = decodePng(await page.screenshot({ ...opts, clip: { x, y: y + ty, width: w, height: th } }));
    tile.data.copy(out.data, ty * w * 4, 0, Math.min(tile.data.length, th * w * 4));
    tiles++;
  }
  return { image: out, fullSize: [w, h], tiles };
}

/** Viewport screenshot of a lens rect, inset by 1px. */
export async function lensShot(page, rect) {
  const [x, y, w, h] = rect;
  const clip = { x: Math.ceil(x) + 1, y: Math.ceil(y) + 1, width: Math.floor(w) - 2, height: Math.floor(h) - 2 };
  return decodePng(await page.screenshot({ clip, animations: "disabled", caret: "hide" }));
}
