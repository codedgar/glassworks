// Per-test JSON records; tests/report.mjs aggregates them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RESULTS = path.join(ROOT, "test-results");
export const RECORDS = path.join(RESULTS, "records");
export const ARTIFACTS = path.join(RESULTS, "artifacts");

export function rel(p) {
  return path.relative(ROOT, p);
}

export function artifactDir(...parts) {
  const d = path.join(ARTIFACTS, ...parts.map(String));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function writeRecord(name, data) {
  fs.mkdirSync(RECORDS, { recursive: true });
  const file = path.join(RECORDS, name.replace(/[^\w.-]+/g, "_") + ".json");
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
