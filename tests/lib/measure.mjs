// Measurement helpers for the Glassworks harness. Pure Node: every verdict
// here comes from a number, never from looking at an image.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { CRITERIA } from "./criteria.mjs";

/* ---------------- image utilities ---------------- */

export function decodePng(buf) {
  return PNG.sync.read(buf);
}

export function decodeDataUrl(dataUrl) {
  return decodePng(Buffer.from(dataUrl.split(",")[1], "base64"));
}

export function writePng(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(img));
  return file;
}

export function blank(width, height) {
  return new PNG({ width, height, fill: true });
}

export function crop(img, x, y, w, h) {
  const out = blank(w, h);
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= img.height) continue;
    for (let col = 0; col < w; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= img.width) continue;
      const si = (sy * img.width + sx) * 4;
      const di = (row * w + col) * 4;
      img.data.copy(out.data, di, si, si + 4);
    }
  }
  return out;
}

/** Translate an image by (dx, dy), leaving uncovered pixels transparent. */
export function shift(img, dx, dy) {
  const out = blank(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < img.width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= img.width) continue;
      const si = (sy * img.width + sx) * 4;
      img.data.copy(out.data, (y * img.width + x) * 4, si, si + 4);
    }
  }
  return out;
}

/** Area-average resample (box filter). Used only when the capture scale
 *  differs from the ground-truth scale (e.g. MAX_TEXTURE_SIZE clamping). */
export function resample(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = blank(w, h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      const acc = [0, 0, 0, 0];
      let wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const wgt = wx * wy;
          const i = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += img.data[i + c] * wgt;
          wsum += wgt;
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = Math.round(acc[c] / wsum);
    }
  }
  return out;
}

/* ---------------- Layer A: capture fidelity ---------------- */

/**
 * Compare a capture against ground truth. Ground truth is resampled to the
 * capture's expected size when the capture scale != 1. Returns the diff
 * image too so callers can save it.
 */
export function fidelity(capture, groundTruth, { expectedW, expectedH } = {}) {
  const c = CRITERIA.fidelity;
  expectedW = expectedW ?? groundTruth.width;
  expectedH = expectedH ?? groundTruth.height;
  const resampled = groundTruth.width !== expectedW || groundTruth.height !== expectedH;
  const gt = resampled ? resample(groundTruth, expectedW, expectedH) : groundTruth;
  const dimOk =
    Math.abs(capture.width - expectedW) <= c.dimTolerancePx &&
    Math.abs(capture.height - expectedH) <= c.dimTolerancePx;
  // Compare over the expected area; missing capture pixels count as diffs.
  const a = crop(capture, 0, 0, expectedW, expectedH);
  const diff = blank(expectedW, expectedH);
  const diffPixels = pixelmatch(a.data, gt.data, diff.data, expectedW, expectedH, {
    threshold: c.pixelmatchThreshold,
    includeAA: c.includeAA,
  });
  const diffRatio = diffPixels / (expectedW * expectedH);
  const pass = dimOk && diffRatio <= c.maxDiffRatio;
  const reg = registration(capture, gt, expectedW, Math.min(expectedH, 1200));
  return {
    verdict: pass ? "pass" : "fail",
    diffRatio,
    diffPixels,
    captureSize: [capture.width, capture.height],
    expectedSize: [expectedW, expectedH],
    groundTruthSize: [groundTruth.width, groundTruth.height],
    dimOk,
    groundTruthResampled: resampled,
    // Informational only (verdict uses the unshifted comparison): the integer
    // shift in [-2, 2]² of the capture that best matches ground truth, measured
    // on the top min(H, 1200) rows.
    bestShift: reg.best,
    diffRatioAtBestShift: reg.ratio,
    diffImage: diff,
    groundTruthCompared: gt,
  };
}

function registration(capture, gt, w, h) {
  const g = crop(gt, 0, 0, w, h);
  let best = [0, 0], ratio = Infinity;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const a = crop(capture, -dx, -dy, w, h); // content shifted by (dx, dy)
      const n = pixelmatch(a.data, g.data, null, w, h, { threshold: CRITERIA.fidelity.pixelmatchThreshold, includeAA: CRITERIA.fidelity.includeAA });
      const r = n / (w * h);
      if (r < ratio) { ratio = r; best = [dx, dy]; }
    }
  return { best, ratio };
}

/* ---------------- Layer B: fiducial markers ---------------- */

export function parseColor(str) {
  if (!str) return null;
  if (str[0] === "#") return [1, 3, 5].map((i) => parseInt(str.slice(i, i + 2), 16)).concat(255);
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? Math.round(p[3] * 255) : 255];
}

/** Median of an N×N block centred on (x, y); null if the block leaves the image. */
export function sampleMedian(img, x, y, n = CRITERIA.fiducial.sampleSize) {
  const half = Math.floor(n / 2);
  const cx = Math.round(x), cy = Math.round(y);
  if (cx - half < 0 || cy - half < 0 || cx + half >= img.width || cy + half >= img.height) return null;
  const ch = [[], [], [], []];
  for (let yy = cy - half; yy <= cy + half; yy++)
    for (let xx = cx - half; xx <= cx + half; xx++) {
      const i = (yy * img.width + xx) * 4;
      for (let c = 0; c < 4; c++) ch[c].push(img.data[i + c]);
    }
  return ch.map((v) => v.sort((p, q) => p - q)[Math.floor(v.length / 2)]);
}

/**
 * points: [{ name, x, y, color }] where x/y are CSS px relative to the
 * snapshot target's border box. scale maps CSS px -> image px.
 */
export function fiducials(img, points, scale) {
  const tol = CRITERIA.fiducial.channelTolerance;
  const results = points.map((p) => {
    const ix = p.x * scale, iy = p.y * scale;
    const expected = parseColor(p.color);
    const actual = sampleMedian(img, ix, iy);
    let pass = false, maxDelta = null, reason = null;
    if (!actual) reason = "out-of-bounds";
    else {
      maxDelta = Math.max(...[0, 1, 2].map((c) => Math.abs(actual[c] - expected[c])));
      pass = maxDelta <= tol && actual[3] >= CRITERIA.fiducial.minAlpha;
      if (!pass) reason = actual[3] < CRITERIA.fiducial.minAlpha ? "transparent" : "colour-mismatch";
    }
    return {
      name: p.name,
      cssPos: [round2(p.x), round2(p.y)],
      imagePos: [round2(ix), round2(iy)],
      expected,
      actual,
      maxDelta,
      verdict: pass ? "pass" : "fail",
      reason,
    };
  });
  return { verdict: results.every((r) => r.verdict === "pass") ? "pass" : "fail", markers: results };
}

/* ---------------- Layer C: blank-region scan ---------------- */

export function blankScan(img) {
  const { width: w, height: h, data } = img;
  const T = CRITERIA.blank;
  const pxTransparent = (i) => data[i + 3] <= T.alphaMax;
  const pxBlack = (i) => data[i + 3] >= T.opaqueMin && data[i] <= T.rgbMax && data[i + 1] <= T.rgbMax && data[i + 2] <= T.rgbMax;
  const rowT = new Uint8Array(h), rowB = new Uint8Array(h), rowX = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    let allT = true, allB = true, allX = true;
    for (let x = 0; x < w && (allT || allB || allX); x++) {
      const i = (y * w + x) * 4;
      const t = pxTransparent(i), b = pxBlack(i);
      if (!t) allT = false;
      if (!b) allB = false;
      if (!t && !b) allX = false;
    }
    rowT[y] = allT; rowB[y] = allB; rowX[y] = allX;
  }
  let colT = 0, colB = 0, colX = 0;
  for (let x = 0; x < w; x++) {
    let allT = true, allB = true, allX = true;
    for (let y = 0; y < h && (allT || allB || allX); y++) {
      const i = (y * w + x) * 4;
      const t = pxTransparent(i), b = pxBlack(i);
      if (!t) allT = false;
      if (!b) allB = false;
      if (!t && !b) allX = false;
    }
    colT += allT; colB += allB; colX += allX;
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  // First y from which every remaining row is blank (content stops).
  let contentStopsAt = null;
  if (h > 0 && rowX[h - 1]) {
    let y = h - 1;
    while (y > 0 && rowX[y - 1]) y--;
    contentStopsAt = y;
  }
  const blankRows = sum(rowX);
  const colBlank = (x) => {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (!pxTransparent(i) && !pxBlack(i)) return false;
    }
    return true;
  };
  const run = (n, test) => { let k = 0; while (k < n && test(k)) k++; return k; };
  const edges = {
    top: run(h, (k) => rowX[k]),
    bottom: run(h, (k) => rowX[h - 1 - k]),
    left: run(w, (k) => colBlank(k)),
    right: run(w, (k) => colBlank(w - 1 - k)),
  };
  return {
    verdict: blankRows === 0 && colX === 0 ? "pass" : "fail",
    size: [w, h],
    transparentRows: sum(rowT),
    blackRows: sum(rowB),
    blankRows,
    transparentCols: colT,
    blackCols: colB,
    blankCols: colX,
    blankEdges: edges, // consecutive blank rows/cols from each edge
    contentStopsAt,
    contentStopsAtCss: null,
  };
}

/* ---------------- Layer D: shader identity ---------------- */

export function shaderIdentity(withLib, withoutLib) {
  const c = CRITERIA.shaderIdentity;
  const w = Math.min(withLib.width, withoutLib.width);
  const h = Math.min(withLib.height, withoutLib.height);
  const a = crop(withLib, 0, 0, w, h), b = crop(withoutLib, 0, 0, w, h);
  const diff = blank(w, h);
  const diffPixels = pixelmatch(a.data, b.data, diff.data, w, h, {
    threshold: c.pixelmatchThreshold,
    includeAA: c.includeAA,
  });
  const diffRatio = diffPixels / (w * h);
  return { verdict: diffRatio <= c.maxDiffRatio ? "pass" : "fail", diffRatio, diffPixels, size: [w, h], diffImage: diff };
}

/* ---------------- Layer E: timing ---------------- */

export function stats(values) {
  const v = values.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, min: null, max: null };
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { n: v.length, median: round2(median), min: round2(v[0]), max: round2(v[v.length - 1]) };
}

export function round2(n) {
  return typeof n === "number" ? Math.round(n * 100) / 100 : n;
}
