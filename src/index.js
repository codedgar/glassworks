/* Glassworks — liquid glass for the web.
 *
 *   import glassworks, { createSnapdomEngine } from "@codedgar/glassworks";
 *   import { snapdom } from "@zumer/snapdom";
 *   glassworks({ target: ".glass", engine: createSnapdomEngine(snapdom) });
 *
 * With a <script> tag the UMD build assigns window.glassworks (and
 * window.liquidGL for backwards compatibility) and picks up window.snapdom.
 */
import { glassworks } from "./api.js";
import {
  registerEngine,
  getRegisteredEngine,
  createSnapdomEngine,
  createHtml2canvasEngine,
  resolveEngine,
  GlassworksEngineError,
} from "./capture/engines.js";
import { captureToCanvas } from "./capture/index.js";
import { liquidGLRenderer } from "./renderer.js";
import { liquidGLLens } from "./lens.js";

/* Replaced at build time by esbuild's define. */
export const version = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";

glassworks.registerEngine = registerEngine;
glassworks.getEngine = getRegisteredEngine;
glassworks.createSnapdomEngine = createSnapdomEngine;
glassworks.createHtml2canvasEngine = createHtml2canvasEngine;
glassworks.resolveEngine = resolveEngine;
glassworks.capture = captureToCanvas;
glassworks.version = version;

export default glassworks;
export {
  glassworks,
  registerEngine,
  getRegisteredEngine,
  createSnapdomEngine,
  createHtml2canvasEngine,
  resolveEngine,
  captureToCanvas,
  GlassworksEngineError,
  liquidGLRenderer,
  liquidGLLens,
};
