import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, cp, appendFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const directory = process.env.ORBIT_VERIFICATION_DIRECTORY ?? `artifacts/rework-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
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
// Evidence identity must cover every input this verification run depends on:
// application source, tests, scripts, prisma, contracts, infra, CI, planning
// governance and the ignore rules that shape the delivery.
async function sourceManifest() {
const paths = [
  "package.json", "pnpm-lock.yaml", "next.config.ts", "vitest.config.ts",
  "playwright.config.ts", "playwright.ui.config.ts", "eslint.config.mjs",
  "tsconfig.json", "tsconfig.scripts.json", "Dockerfile", ".gitignore",
  ".dockerignore", ".env.example", "PROGRESS.md", "README.md", "README.en.md", "AGENTS.md", "prisma.config.ts",
];
for (const dir of ["src", "tests", "scripts", "prisma", "contracts", "infra", "planning", ".github", "docs", "prompts"]) paths.push(...await sourceFiles(dir));
const files = [];
for (const path of paths.sort()) files.push({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
return files;
}
const files = await sourceManifest();
await writeFile(join(directory, "source-hashes.json"), JSON.stringify(files, null, 2));
const sourceDigest = createHash("sha256").update(JSON.stringify(files)).digest("hex");
const summary = { startedAt: new Date().toISOString(), sourceDigest, head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), dirty: spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout.trim().length > 0, checks: [] };

// A check FAILS unless the real child process exits 0 on its own. Passing test
// text in the log never overrides the exit code, so a "tests passed but global
// teardown failed" run (vitest exit 1) is recorded and treated as a failure.
async function runCheck(name, command, args) {
  const logPath = join(directory, `${name}.log`), stream = createWriteStream(logPath);
  const began = Date.now();
  let exitCode = null, signal = null, spawnError = null;
  await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { shell: command === "pnpm" && process.platform === "win32", windowsHide: true });
    } catch (error) {
      spawnError = String(error); stream.end(resolve); return;
    }
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
    child.once("error", (error) => { spawnError = String(error); });
    child.once("close", (code, sig) => { signal = sig ?? null; stream.end(() => { exitCode = code ?? 1; resolve(); }); });
  });
  if (spawnError) { await appendFile(logPath, `\n[runner] spawn error: ${spawnError}\n`); exitCode = 127; }
  const log = await readFile(logPath, "utf8");
  const clean = log.replace(/\x1b\[[0-9;]*m/g, "");
  const count = /Tests\s+(\d+) passed/.exec(clean)?.[1] ?? /(?:^|\n)\s*(\d+) passed \(/.exec(clean)?.[1];
  const outcome = { name, command: [command, ...args], startedAt: new Date(began).toISOString(), finishedAt: new Date().toISOString(), exitCode, signal, spawnError, failed: exitCode !== 0 || signal !== null || spawnError !== null, passed: exitCode === 0 && count ? Number(count) : null, durationMs: Date.now() - began, logSha256: createHash("sha256").update(log).digest("hex"), sourceDigest };
  summary.checks.push(outcome);
  await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(outcome));
  return outcome;
}

if (process.argv.includes("--self-test")) {
  // Controlled reproduction of "tests passed but teardown failed": the child
  // prints a passing summary and then exits 1. The runner must judge it failed.
  const failing = await runCheck("self-test-teardown-failure", process.execPath, ["-e", "console.log(' Test Files  35 passed (35)'); console.log('      Tests  360 passed (360)'); process.exit(1);"]);
  const passing = await runCheck("self-test-clean-pass", process.execPath, ["-e", "console.log('      Tests  3 passed (3)');"]);
  const missing = await runCheck("self-test-missing-binary", "orbit-definitely-missing-command", ["--version"]);
  const signalled = await runCheck("self-test-signal", process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]);
  const ok = failing.failed && failing.exitCode === 1 && passing.exitCode === 0 && missing.failed && signalled.failed;
  console.log(ok ? "self-test: teardown failure and spawn failure correctly judged as failures" : "self-test: FAILED");
  process.exit(ok ? 0 : 1);
}

const checks = [
  ["planning", "python", ["planning/validate_plan.py", "--check"]],
  ["probes", "python", ["planning/validate_plan_probes.py"]],
  ["status", "python", ["planning/current_status.py", "--check"]],
  ["image-policy", process.execPath, ["scripts/verify-image-policy.mjs"]],
  ["lint", "pnpm", ["lint"]], ["typecheck", "pnpm", ["typecheck"]],
  ["scripts", "pnpm", ["typecheck:scripts"]], ["unit", "pnpm", ["test:unit"]],
  ["contract", "pnpm", ["test:contract"]], ["integration", "pnpm", ["test:integration"]],
  ["e2e", "pnpm", ["test:e2e", "--retries=0"]],
  ["bundles", process.execPath, ["scripts/measure-client-bundles.mjs"]],
  ["ui", "pnpm", ["test:ui", "--retries=0"]],
  ["audit", "pnpm", ["audit", "--prod", "--audit-level=high", "--json"]],
];
const requested = process.argv.find(arg => arg.startsWith("--only="))?.slice(7).split(",");
if (requested?.some(name => !checks.some(check => check[0] === name))) throw new Error("Unknown requested check");
for (const [name, command, args] of checks) {
  if (requested && !requested.includes(name)) continue;
  const outcome = await runCheck(name, command, args);
  if (outcome.failed) {
    if (name === "e2e" || name === "ui") await cp("test-results", join(directory, `${name}-failure`), { recursive: true }).catch(() => {});
    process.exitCode = outcome.exitCode; break;
  }
}
const after = await sourceManifest();
await writeFile(join(directory, "source-hashes-after.json"), JSON.stringify(after, null, 2));
summary.finishedAt = new Date().toISOString();
summary.sourceUnchanged = JSON.stringify(files) === JSON.stringify(after);
summary.result = !summary.sourceUnchanged || summary.checks.some(check => check.failed) ? "FAIL" : "PASS";
await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
if (!summary.sourceUnchanged) { console.error("Verification source changed during the run; evidence is not a frozen candidate."); process.exitCode = 1; }
console.log(JSON.stringify({ result: summary.result, sourceUnchanged: summary.sourceUnchanged, directory }));
