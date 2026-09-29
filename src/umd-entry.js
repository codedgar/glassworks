/* UMD/global entry: keeps the historical window.liquidGL API working while
 * exposing the new window.glassworks name. Loaded by a plain <script> tag. */
import glassworks, * as api from "./index.js";

if (typeof window !== "undefined") {
  for (const k of Object.keys(api)) {
    if (k !== "default" && k !== "glassworks") glassworks[k] = api[k];
  }
  window.glassworks = glassworks;
  /* Backwards compatibility: the documented global since the fork. */
  window.liquidGL = glassworks;
}

export default glassworks;
