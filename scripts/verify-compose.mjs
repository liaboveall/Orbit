import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use disposable synthetic env files rather than newer Compose flags whose
// availability differs between Docker Desktop and hosted Linux runners.
const temporary = await mkdtemp(join(tmpdir(), "orbit-compose-check-"));
try {
const environmentFile = join(temporary, "synthetic.env");
await writeFile(environmentFile, "APP_ENV=test\n");
for (const file of ["infra/compose.production.yml", "infra/compose.micro.yml"]) {
  const original = await readFile(file, "utf8");
  const synthetic = original.replace(/^(\s*)env_file:.*$/gm, (_, indent) => `${indent}env_file: [${JSON.stringify(environmentFile.replaceAll("\\", "/"))}]`);
  assert.notEqual(synthetic, original, `No environment declaration found in ${file}`);
  const fixture = join(temporary, "compose.yml");
  await writeFile(fixture, synthetic);
  const result = spawnSync("docker", ["compose", "--env-file", environmentFile, "--profile", "*", "-f", fixture, "config", "--format", "json"], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, ORBIT_IMAGE: "orbit:synthetic", ORBIT_OPERATIONS_IMAGE: "orbit-operations:synthetic", ORBIT_ENV_FILE: "/synthetic/app.env" },
  });
  assert.equal(result.status, 0, `Compose validation failed for ${file}: ${result.stderr}`);
  const config = JSON.parse(result.stdout);
  for (const [name, service] of Object.entries(config.services)) {
    assert.deepEqual(service.logging, { driver: "json-file", options: { "max-size": "10m", "max-file": "3" } }, `${file}: ${name} logging`);
    for (const port of service.ports ?? []) assert.equal(port.host_ip, "127.0.0.1", `${file}: ${name} exposed port`);
  }
  assert.equal(Boolean(config.services.postgres), file.endsWith("micro.yml"));
  assert(config.services.web && config.services.operations);
  console.log(JSON.stringify({ file, parsed: true, logRotation: true, privatePorts: true, database: config.services.postgres ? "local" : "external" }));
}
} finally { await rm(temporary, { recursive: true, force: true }); }
