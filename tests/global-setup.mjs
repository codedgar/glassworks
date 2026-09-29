// Clears previous harness output and materialises the unmodified library
// (from the merge-base with main) for the flag-off equivalence check.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { ROOT, RECORDS, ARTIFACTS, RESULTS } from "./lib/record.mjs";

export default function globalSetup() {
  if (process.env.GLASS_KEEP !== "1") for (const p of [RECORDS, ARTIFACTS]) fs.rmSync(p, { recursive: true, force: true });
  for (const f of ["report.json", "report.md"]) fs.rmSync(path.join(RESULTS, f), { force: true });
  const base = execSync("git merge-base HEAD main", { cwd: ROOT }).toString().trim();
  const src = execSync(`git show ${base}:scripts/liquidGL.js`, { cwd: ROOT, maxBuffer: 64 << 20 });
  const cache = path.join(ROOT, "tests/.cache");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, "liquidGL.main.js"), src);
  fs.writeFileSync(path.join(cache, "base-commit.txt"), base + "\n");
}
