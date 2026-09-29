/* --------------------------------------------------
 *  snapdom adapter (with automatic html2canvas fallback for
 *  the foreignObject completeness bug).
 *  -----------------------------------------------------------
 *  Hiding ignored elements: we mark live-DOM nodes with
 *  `visibility: hidden` for the duration of a capture and restore
 *  immediately after. snapdom v2.9's `filter` option (which would
 *  apply hidden in the cloned DOM only) inflates the canvas
 *  bounding box ~1.6x for reasons we haven't isolated, so we
 *  stick with the live-DOM approach. The window is short
 *  (~50–200ms on Chromium for a viewport-sized capture) so users
 *  rarely see the elements blink. Slow renderers can be addressed
 *  by capturing at a lower scale or against a smaller target.
 *
 *  Black-region fallback: Chromium-family browsers clip
 *  `<foreignObject>` content beyond the viewport-tall portion of
 *  the body — captures of tall pages return mostly-empty canvases
 *  past the first viewport. WebKit handles full-height capture
 *  fine. We detect the failure by sampling the bottom portion of
 *  the canvas; if it's empty we re-run the capture via html2canvas,
 *  which paints regardless of viewport. The chosen engine is
 *  cached on the renderer, so we pay this detection cost once.
 * ------------------------------------------------*/

/* Sample a few rows in the lower half of a captured canvas. If they
   are entirely transparent / black it means snapdom's foreignObject
   was clipped (Chromium bug). Returns true if the snapshot looks
   complete. */
export function snapshotLooksComplete(canvas) {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false;
  if (canvas.height < 200) return true; /* short capture: trust it */
  let ctx;
  try {
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  } catch (_) {
    return true;
  }
  if (!ctx) return true;
  const sampleRows = [
    Math.floor(canvas.height * 0.55),
    Math.floor(canvas.height * 0.75),
    Math.max(0, canvas.height - 32),
  ];
  for (let r = 0; r < sampleRows.length; r++) {
    const y = sampleRows[r];
    let data;
    try {
      data = ctx.getImageData(0, y, canvas.width, 1).data;
    } catch (_) {
      return true;
    }
    let opaqueCount = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 16) opaqueCount++;
    }
    /* If at least 1% of the row has any opacity, this row is fine. */
    if (opaqueCount / total > 0.01) return true;
  }
  return false;
}


