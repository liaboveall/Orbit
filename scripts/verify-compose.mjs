import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

// Parse with synthetic interpolation only. Do not open runtime env files.
for (const file of ["infra/compose.production.yml", "infra/compose.micro.yml"]) {
  const result = spawnSync("docker", ["compose", "--env-file", ".env.example", "--profile", "*", "-f", file, "config", "--no-env-resolution", "--format", "json"], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, ORBIT_IMAGE: "orbit:synthetic", ORBIT_OPERATIONS_IMAGE: "orbit-operations:synthetic", ORBIT_ENV_FILE: "/synthetic/app.env" },
  });
  assert.equal(result.status, 0, `Compose validation failed for ${file}`);
  const config = JSON.parse(result.stdout);
  for (const [name, service] of Object.entries(config.services)) {
    assert.deepEqual(service.logging, { driver: "json-file", options: { "max-size": "10m", "max-file": "3" } }, `${file}: ${name} logging`);
    for (const port of service.ports ?? []) assert.equal(port.host_ip, "127.0.0.1", `${file}: ${name} exposed port`);
  }
  assert.equal(Boolean(config.services.postgres), file.endsWith("micro.yml"));
  assert(config.services.web && config.services.operations);
  console.log(JSON.stringify({ file, parsed: true, logRotation: true, privatePorts: true, database: config.services.postgres ? "local" : "external" }));
}
