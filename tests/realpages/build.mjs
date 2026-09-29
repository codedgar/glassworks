// Builds local, self-contained copies of real pages for the benchmark.
// Network is used HERE ONLY (vendoring); the tests themselves stay offline.
// Every rewrite is recorded in tests/realpages/rewrites.json.
//
//   node tests/realpages/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const PUP = path.resolve(REPO, "../puppertino");
const OUT = HERE;
const rewrites = [];

const log = (page, from, to, why) => rewrites.push({ page, from, to, why });

/* ---------------- shared: vendor a remote asset ---------------- */
const VENDOR = path.join(OUT, "vendor");
fs.mkdirSync(VENDOR, { recursive: true });
const vendored = new Map();

async function vendor(url, hintName) {
  if (vendored.has(url)) return vendored.get(url);
  const name = (hintName || url.split("/").pop().split("?")[0] || "asset").replace(/[^\w.-]+/g, "_");
  const file = path.join(VENDOR, name);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15" } });
  if (!res.ok) throw new Error(`vendor failed ${res.status} ${url}`);
  let body = Buffer.from(await res.arrayBuffer());
  // A stylesheet may itself reference remote files (Google Fonts -> woff2).
  if (/text\/css/.test(res.headers.get("content-type") || "")) {
    let css = body.toString("utf8");
    const urls = [...css.matchAll(/url\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
    for (const u of urls) {
      const local = await vendor(u.replace(/["']/g, ""), path.basename(new URL(u).pathname));
      css = css.split(u).join(`./${path.basename(local)}`);
      log(name, u, `vendor/${path.basename(local)}`, "font file referenced by stylesheet");
    }
    body = Buffer.from(css, "utf8");
  }
  fs.writeFileSync(file, body);
  vendored.set(url, file);
  return file;
}

/* ---------------- 1. Glassworks' own pages ---------------- */
async function buildGlassworks() {
  const dst = path.join(OUT, "glassworks");
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  const pages = ["index.html", ...fs.readdirSync(path.join(REPO, "demos")).filter((f) => f.endsWith(".html")).map((f) => `demos/${f}`)];
  for (const rel of pages) {
    let html = fs.readFileSync(path.join(REPO, rel), "utf8");
    const name = rel.replace(/[\/]/g, "_");
    // Drop preconnect/dns-prefetch hints: they point at origins, not assets.
    html = html.replace(/<link[^>]*rel=["'](?:preconnect|dns-prefetch)["'][^>]*>/g, "");
    log(name, "<link rel=preconnect/dns-prefetch>", "(removed)", "origin hints, no asset to vendor");
    // Vendor every absolute http(s) asset referenced by src/href.
    const assetUrls = [...html.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]);
    for (const url of assetUrls) {
      if (/github\.com|codedgar\.com|#readme/.test(url)) continue; // plain links, not assets
      try {
        const file = await vendor(url);
        const to = `/tests/realpages/vendor/${path.basename(file)}`;
        html = html.split(url).join(to);
        log(name, url, to, "CDN asset vendored");
      } catch (e) {
        log(name, url, "(left as-is, blocked at runtime)", `vendor failed: ${e.message}`);
      }
    }
    // Some pages build CDN URLs inside inline scripts (e.g. the snapdom
    // loader), so rewrite any remaining absolute asset URL in the text too.
    const inlineUrls = [...html.matchAll(/https?:\/\/[^"'`\s)]+\.(?:js|css|woff2?|png|jpe?g|webp|svg|gif|mp4)/g)].map((m) => m[0]);
    for (const url of [...new Set(inlineUrls)]) {
      try {
        const file = await vendor(url);
        const to = `/tests/realpages/vendor/${path.basename(file)}`;
        html = html.split(url).join(to);
        log(name, url, to, "asset URL inside inline script/text");
      } catch (e) {
        log(name, url, "(left as-is)", `vendor failed: ${e.message}`);
      }
    }
    // Pages document.write their own snapdom + liquidGL from an inline
    // loader; point those at a no-op so only the harness's copy loads.
    for (const lit of ["/scripts/liquidGL.js", "/scripts/liquidGL-legacy.js", "/tests/realpages/vendor/snapdom.js", "/scripts/html2canvas.min.js"]) {
      if (html.includes(lit)) {
        html = html.split(lit).join("/tests/realpages/noop.js");
        log(name, lit, "/tests/realpages/noop.js", "page's own engine loader neutralised (harness controls the engine)");
      }
    }
    // Repo-relative assets keep working by pointing back at the repo root.
    html = html.replace(/(src|href)=["'](?!https?:|data:|#|\/)([^"']+)["']/g, (m, attr, p) => `${attr}="/${p}"`);
    log(name, "relative asset paths", "/<repo-root>/…", "served from the repo root");
    // The page's own liquidGL + snapdom tags are replaced by the harness loader.
    html = html.replace(/<script[^>]*(snapdom|liquidGL)[^>]*><\/script>/g, "");
    log(name, "<script> tags for snapdom/liquidGL", "tests/realpages/attach.js", "harness controls engine + version");
    html = html.replace(/<\/head>/i, `<script src="/tests/realpages/attach.js" data-page="${name}"></script></head>`);
    fs.writeFileSync(path.join(dst, name), html);
  }
  return pages.length;
}

/* ---------------- 2. Puppertino docs (Astro build) ---------------- */
function buildPuppertino() {
  if (!fs.existsSync(PUP)) throw new Error(`Puppertino not found at ${PUP}`);
  const src = path.join(PUP, "docs-src/dist");
  const dst = path.join(OUT, "puppertino");
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  const base = "/tests/realpages/puppertino";
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".html")) {
        let html = fs.readFileSync(p, "utf8");
        if (/http-equiv=["']refresh["']/i.test(html)) {
          log(path.relative(dst, p), "(page)", "(skipped)", "meta-refresh redirect stub, not a real page");
          continue;
        }
        html = html.split('"/Puppertino/').join(`"${base}/`).split("'/Puppertino/").join(`'${base}/`);
        html = html.replace(/<\/head>/i, `<script src="/tests/realpages/attach.js" data-page="puppertino_${path.relative(dst, p).replace(/[\/]/g, "_")}"></script></head>`);
        fs.writeFileSync(p, html);
        n++;
      } else if (e.name.endsWith(".css") || e.name.endsWith(".js")) {
        let t = fs.readFileSync(p, "utf8");
        if (t.includes("/Puppertino/")) fs.writeFileSync(p, t.split("/Puppertino/").join(`${base}/`));
      }
    }
  };
  walk(dst);
  log("puppertino/*", "/Puppertino/…", `${base}/…`, "GitHub Pages base path rewritten for local serving");
  log("puppertino/*", "</head>", "tests/realpages/attach.js", "harness loader injected");
  return n;
}

const g = await buildGlassworks();
const p = buildPuppertino();
fs.writeFileSync(path.join(OUT, "rewrites.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rewrites }, null, 2));
console.log(`glassworks pages: ${g}, puppertino pages: ${p}, vendored files: ${vendored.size}, rewrites logged: ${rewrites.length}`);
