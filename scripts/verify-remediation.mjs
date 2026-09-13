import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, cp } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const directory = "artifacts/rework-20260913/final";
await mkdir(directory, { recursive: true });
async function sourceFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (["generated", "__pycache__"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path)); else result.push(path);
  }
  return result;
}
const paths = ["package.json", "pnpm-lock.yaml", "next.config.ts", "vitest.config.ts", "playwright.config.ts", "playwright.ui.config.ts"];
for (const dir of ["src", "tests", "scripts", "prisma", "contracts", "infra"]) paths.push(...await sourceFiles(dir));
const files = [];
for (const path of paths.sort()) files.push({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
await writeFile(join(directory, "source-hashes.json"), JSON.stringify(files, null, 2));
const sourceDigest = createHash("sha256").update(JSON.stringify(files)).digest("hex");
const summary = { startedAt: new Date().toISOString(), sourceDigest, head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), checks: [] };
const checks = [
  ["lint", "pnpm", ["lint"]], ["typecheck", "pnpm", ["typecheck"]],
  ["scripts", "pnpm", ["typecheck:scripts"]], ["unit", "pnpm", ["test:unit"]],
  ["contract", "pnpm", ["test:contract"]], ["integration", "pnpm", ["test:integration"]],
  ["e2e", "pnpm", ["test:e2e", "--retries=0"]],
  ["bundles", process.execPath, ["scripts/measure-client-bundles.mjs"]],
  ["ui", "pnpm", ["test:ui", "--retries=0"]],
  ["audit", "pnpm", ["audit", "--prod", "--json"]],
];
for (const [name, command, args] of checks) {
  const logPath = join(directory, `${name}.log`), stream = createWriteStream(logPath);
  const began = Date.now();
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: command === "pnpm" && process.platform === "win32", windowsHide: true });
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
    child.once("error", reject);
    child.once("close", code => stream.end(() => resolve(code ?? 1)));
  });
  const log = await readFile(logPath, "utf8");
  const clean = log.replace(/\x1b\[[0-9;]*m/g, "");
  const count = /Tests\s+(\d+) passed/.exec(clean)?.[1] ?? /(?:^|\n)\s*(\d+) passed \(/.exec(clean)?.[1];
  summary.checks.push({ name, command: [command, ...args], exitCode, passed: count ? Number(count) : null, durationMs: Date.now() - began, logSha256: createHash("sha256").update(log).digest("hex"), sourceDigest });
  await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.checks.at(-1)));
  if (exitCode !== 0) {
    if (name === "e2e" || name === "ui") await cp("test-results", join(directory, `${name}-failure`), { recursive: true });
    process.exitCode = exitCode; break;
  }
}
