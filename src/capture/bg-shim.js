/* --------------------------------------------------
 *  CSS background-image shim for WebKit.
 *  -----------------------------------------------------------
 *  On WebKit/Safari, snapdom drops CSS `background-image: url(...)`
 *  declarations from the rasterised foreignObject (probably the
 *  same long-standing WebKit bug that affects html2canvas too —
 *  CSS bg images simply don't paint inside `<foreignObject>`).
 *  `<img>` tags, on the other hand, render fine.
 *
 *  Workaround: right before snapdom captures, walk the target
 *  for elements whose computed `background-image` is a single
 *  url(...) and inject a transparent absolutely-positioned `<img>`
 *  child that paints the same image at the same size/position.
 *  snapdom captures the `<img>`; we remove it immediately after.
 *  Because the inserted image visually matches the live bg, the
 *  user never sees a flash even if the capture takes a moment.
 *
 *  Engine-agnostic. Does the right thing on engines where snapdom
 *  *would* have captured the bg fine — same image gets rendered
 *  in the same place, no visible difference, ~5–20ms overhead.
 * ------------------------------------------------*/
export function parseBackgroundImageUrl(value) {
  if (!value || value === "none") return null;
  /* Only single url() backgrounds. Comma-separated stacks and
     gradient layers are uncommon for the snapshot-target case
     and snapdom already handles gradients via the SVG paint-
     server path (which works on WebKit). */
  const m = value.match(/^url\(["']?([^)"']+)["']?\)\s*$/);
  return m ? m[1] : null;
}

function bgPositionToObjectPosition(posStr) {
  /* CSS `background-position` and `object-position` use the same
     grammar for the cases we care about (keywords, %, px). For
     the homepage's `background-position: center` this is a 1:1
     carry-over. */
  return posStr || "50% 50%";
}

function bgSizeToObjectFit(sizeStr) {
  if (sizeStr === "cover") return "cover";
  if (sizeStr === "contain") return "contain";
  return "cover";
}

export async function injectBackgroundImageShims(target) {
  /* Returns a list of cleanup functions to run after snapdom
     captures. Each function removes the injected <img> and
     restores the host element's CSS if we changed it. The
     function awaits all shim loads before resolving so snapdom
     sees fully-decoded `<img>` elements (an empty `<img>` would
     serialise the same way the bg-image does — i.e. blank). */
  const cleanups = [];
  const loadPromises = [];
  if (!target || !target.querySelectorAll) return cleanups;
  const all = target.querySelectorAll("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    let cs;
    try {
      cs = window.getComputedStyle(el);
    } catch (_) {
      continue;
    }
    const url = parseBackgroundImageUrl(cs.backgroundImage);
    if (!url) continue;

    /* The shim has to paint *behind* the host's normal-flow
       children (so the existing text remains in front). That
       means giving it `z-index: -1` inside a stacking context
       scoped to the host. We create that context with
       `isolation: isolate` (no layout side-effects) and set
       `position: relative` if the host is currently `static`
       so the absolutely-positioned shim resolves against it. */
    const restoreFns = [];
    if (cs.position === "static") {
      const prev = el.style.position;
      el.style.position = "relative";
      restoreFns.push(() => { el.style.position = prev; });
    }
    if (cs.isolation !== "isolate") {
      const prev = el.style.isolation;
      el.style.isolation = "isolate";
      restoreFns.push(() => { el.style.isolation = prev; });
    }

    const shim = document.createElement("img");
    shim.crossOrigin = "anonymous";
    /* Attribute the shim so the lens-renderer's ignore predicate
       and other tooling don't pick it up during the same capture. */
    shim.setAttribute("data-liquidgl-bg-shim", "");
    shim.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "object-fit:" + bgSizeToObjectFit(cs.backgroundSize),
      "object-position:" + bgPositionToObjectPosition(cs.backgroundPosition),
      "pointer-events:none",
      "z-index:-1",
      "border-radius:" + cs.borderRadius,
      "user-select:none",
    ].join(";");

    /* Resolve as soon as the shim is decoded, or after a short
       timeout so a slow / failing image doesn't block the capture
       indefinitely (snapdom will then capture an empty <img>
       placeholder, identical behaviour to the pre-fix code). */
    const loadP = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      shim.addEventListener("load", finish, { once: true });
      shim.addEventListener("error", finish, { once: true });
      setTimeout(finish, 1500);
    });
    shim.src = url;
    loadPromises.push(loadP);
    el.insertBefore(shim, el.firstChild);

    cleanups.push(() => {
      if (shim.parentNode) shim.parentNode.removeChild(shim);
      for (let r = restoreFns.length - 1; r >= 0; r--) restoreFns[r]();
    });
  }
  if (loadPromises.length) await Promise.all(loadPromises);
  return cleanups;
}
