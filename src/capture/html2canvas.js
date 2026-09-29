/* html2canvas: lazy loader (CDN or window.LIQUIDGL_HTML2CANVAS_URL) and the
 * full-target capture path used as the fallback engine. */

/* --------------------------------------------------
 *  html2canvas lazy-loader (only fetched when the snapdom path
 *  hits a layout pattern it can't render: position:absolute
 *  descendants of the snapshot target with viewport-relative
 *  containing blocks).
 * ------------------------------------------------*/
const HTML2CANVAS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
let _h2cLoadPromise = null;

/** True when a lazy load could still produce html2canvas (browser + a URL). */
export function canLazyLoadHtml2canvas() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function ensureHtml2canvas() {
  if (typeof window.html2canvas === "function") {
    return Promise.resolve(window.html2canvas);
  }
  if (_h2cLoadPromise) return _h2cLoadPromise;
  _h2cLoadPromise = new Promise((resolve, reject) => {
    const url = window.LIQUIDGL_HTML2CANVAS_URL || HTML2CANVAS_CDN;
    const s = document.createElement("script");
    s.src = url;
    s.crossOrigin = "anonymous";
    s.onload = () => {
      if (typeof window.html2canvas === "function") {
        resolve(window.html2canvas);
      } else {
        _h2cLoadPromise = null;
        reject(new Error("liquidGL: html2canvas script loaded but global is missing"));
      }
    };
    s.onerror = () => {
      _h2cLoadPromise = null;
      reject(new Error("liquidGL: failed to lazy-load html2canvas from " + url));
    };
    document.head.appendChild(s);
  });
  return _h2cLoadPromise;
}

/* --------------------------------------------------
 *  html2canvas full-target capture (engine: "html2canvas"
 *  or auto-fallback when snapdom returns an incomplete canvas).
 *  Uses `data-liquidgl-hide` + the `onclone` hook to apply
 *  visibility:hidden in the cloned document (no live-DOM
 *  mutation visible to the user).
 * ------------------------------------------------*/
export async function captureViaHtml2canvas(target, { scale, ignore, engine } = {}) {
  const html2canvas = engine ? engine.raw : await ensureHtml2canvas();
  const restores = [];

  if (typeof ignore === "function") {
    const all = target.querySelectorAll("*");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      try {
        if (ignore(el)) {
          el.setAttribute("data-liquidgl-hide", "");
          restores.push(() => {
            el.removeAttribute("data-liquidgl-hide");
          });
        }
      } catch (_) {
        /* defensive */
      }
    }
  }

  try {
    const fullW = target.scrollWidth;
    const fullH = target.scrollHeight;
    return await html2canvas(target, {
      allowTaint: false,
      useCORS: true,
      backgroundColor: null,
      removeContainer: true,
      width: fullW,
      height: fullH,
      scrollX: 0,
      scrollY: 0,
      scale: scale,
      logging: false,
      ignoreElements: (element) => {
        return (
          element &&
          element.tagName === "CANVAS" &&
          element.hasAttribute &&
          element.hasAttribute("data-liquid-ignore")
        );
      },
      onclone: (clonedDoc) => {
        clonedDoc
          .querySelectorAll("[data-liquidgl-hide]")
          .forEach((el) => {
            el.style.visibility = "hidden";
          });
      },
    });
  } finally {
    for (let i = restores.length - 1; i >= 0; i--) {
      restores[i]();
    }
  }
}
