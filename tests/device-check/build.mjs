// Builds tests/device-check.html: one self-contained file (no network) that
// runs the harness checks in a real browser, e.g. Safari on a Mac or iPhone.
//   node tests/device-check/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const VERSIONS = ["2.9.0", "2.24.15", "3.1.0"];

const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
// Each SnapDOM build assigns window.snapdom; capture it under a version key
// so all three can coexist in one document.
const engines = VERSIONS.map((v) => `
/* ---- snapdom ${v} ---- */
(function(){ var prev = window.snapdom;
${read(`node_modules/snapdom-${v}/dist/snapdom.js`)}
window.__engines["${v}"] = window.snapdom; window.snapdom = prev; })();`).join("\n");

const page = read("tests/device-check/template.html.tpl")
  .replace("/*__ENGINES__*/", () => `window.__engines = {};\n${engines}`)
  .replace("/*__GLASSWORKS__*/", () => read("scripts/liquidGL.js"))
  .split("__VERSIONS__").join(JSON.stringify(VERSIONS));

const out = path.join(REPO, "tests/device-check.html");
fs.writeFileSync(out, page);
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`tests/device-check.html written: ${kb} KB (engines: ${VERSIONS.join(", ")})`);
