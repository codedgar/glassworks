import { buildReport } from "./report.mjs";
export default async function globalTeardown() {
  await buildReport();
}
