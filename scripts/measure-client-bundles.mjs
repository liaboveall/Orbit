import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.name.endsWith("client-reference-manifest.js")) result.push(path);
  }
  return result;
}
const rows = [];
for (const path of await files(".next/server/app/app")) {
  const context = { globalThis: {} };
  runInNewContext(await readFile(path, "utf8"), context);
  for (const [route, manifest] of Object.entries(context.globalThis.__RSC_MANIFEST)) {
    const modules = Object.keys(manifest.clientModules);
    const chunks = new Set(Object.values(manifest.clientModules).flatMap(value => value.chunks).filter(value => typeof value === "string" && value.endsWith(".js")));
    let rawBytes = 0;
    for (const chunk of chunks) rawBytes += (await stat(join(".next", chunk.replace(/^\/?_next\//, "")))).size;
    const sampleModules = modules.filter(module => /\/app\/(ui-samples|samples)\//.test(module) || /\/features\/board\/board-view\.tsx/.test(module));
    rows.push({ route, manifest: relative(".next", path), chunks: chunks.size, rawBytes, sampleModules });
  }
}
const leaks = rows.filter(row => !/\/app\/(ui-samples|samples)\//.test(row.route) && row.sampleModules.length);
await mkdir("artifacts/rework-20260913", { recursive: true });
await writeFile("artifacts/rework-20260913/client-bundles.json", JSON.stringify({ measurement: "union of client-reference chunks, raw bytes; shared chunks counted once per route, not marginal component size", rows, realRouteSampleLeaks: leaks }, null, 2));
console.log(JSON.stringify({ routes: rows.length, realRouteSampleLeaks: leaks.length }));
if (leaks.length) process.exitCode = 1;
