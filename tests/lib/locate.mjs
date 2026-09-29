// Diagnostic for tall lab captures: find where each marker colour actually
// appears in the capture's centre column (±12 per channel), so a failed
// proportional-position check can be told apart from missing content.
import fs from "node:fs";
import path from "node:path";
import { decodePng, parseColor } from "./measure.mjs";
import { ROOT } from "./record.mjs";

export function locateMarkers(capture) {
  if (!capture || !capture.artifact || !capture.points) return null;
  const img = decodePng(fs.readFileSync(path.join(ROOT, capture.artifact)));
  const x = Math.floor(img.width / 2);
  return capture.points.map((p) => {
    const c = parseColor(p.expected ? `rgb(${p.expected.slice(0, 3).join(",")})` : p.color);
    let first = -1, last = -1;
    for (let y = 0; y < img.height; y++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] >= 240 && Math.abs(img.data[i] - c[0]) <= 12 && Math.abs(img.data[i + 1] - c[1]) <= 12 && Math.abs(img.data[i + 2] - c[2]) <= 12) {
        if (first < 0) first = y;
        last = y;
      }
    }
    const found = first >= 0;
    return { name: p.name, found, rows: found ? [first, last] : null, heightPx: found ? last - first + 1 : 0, predictedY: p.imagePos[1], offsetPx: found ? Math.round((first + last) / 2 - p.imagePos[1]) : null };
  });
}
