// Builds dist/ from src/. The UMD output is also written to
// scripts/liquidGL.js so existing CDN/script-tag users keep working.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const banner = `/*!
 * Glassworks v${pkg.version} — liquid glass for the web
 * ${pkg.homepage}
 * Licence: MIT. Forked from liquidGL by NaughtyDuk©.
 */`;

const define = { __VERSION__: JSON.stringify(pkg.version) };
const common = { bundle: true, target: ["es2019"], define, banner: { js: banner }, logLevel: "warning" };

const outputs = [
  { entryPoints: ["src/index.js"], outfile: "dist/glassworks.esm.js", format: "esm" },
  { entryPoints: ["src/index.js"], outfile: "dist/glassworks.cjs", format: "cjs" },
  { entryPoints: ["src/umd-entry.js"], outfile: "dist/glassworks.umd.js", format: "iife" },
  { entryPoints: ["src/umd-entry.js"], outfile: "dist/glassworks.umd.min.js", format: "iife", minify: true },
];

for (const o of outputs) await build({ ...common, ...o });

/* Keep the historical path working: same content as the UMD build. */
fs.copyFileSync("dist/glassworks.umd.js", "scripts/liquidGL.js");

const size = (f) => (fs.statSync(f).size / 1024).toFixed(1) + " KB";
for (const o of outputs) console.log(`${o.outfile.padEnd(30)} ${size(o.outfile)}`);
console.log(`${"scripts/liquidGL.js".padEnd(30)} ${size("scripts/liquidGL.js")} (copy of the UMD build)`);
