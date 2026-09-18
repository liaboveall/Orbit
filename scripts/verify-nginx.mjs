import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const directory = resolve("artifacts/comprehensive-20260913/nginx");
await mkdir(directory, { recursive: true });
const http = await readFile("infra/nginx-http.conf", "utf8");
const server = await readFile("infra/nginx.conf", "utf8");
const config = `events {}\nhttp {\n${http}\nserver { listen 8080; ${server} }\nserver { listen 3000; access_log off; error_log /dev/null; location = /__review_failure { return 503; } location / { return 204; } }\n}`;
const path = resolve(directory, "nginx.conf");
await writeFile(path, config);
const name = "orbit-nginx-review-" + randomUUID();
const docker = args => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 120000 }).trim();
const image = process.env.NGINX_TEST_IMAGE ?? "nginx@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c";
let created = false;
try {
  docker(["run", "--detach", "--name", name, "-p", "127.0.0.1::8080", "--mount", `type=bind,source=${path},target=/etc/nginx/nginx.conf,readonly`, image]);
  created = true;
  docker(["exec", name, "nginx", "-t"]);
  const port = docker(["port", name, "8080/tcp"]).split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  const secret = "synthetic-private-" + randomUUID();
  const headers = { referer: `https://example.invalid/${secret}`, cookie: `session=${secret}` };
  const responses = await Promise.all(Array.from({ length: 60 }, () => fetch(`${base}/api/auth/${secret}?token=${secret}`, { headers })));
  const rejected = responses.filter(response => response.status === 429);
  assert(rejected.length > 0 && responses.some(response => response.status === 204));
  for (const response of rejected) {
    assert.equal(response.headers.get("retry-after"), "1");
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
  }
  // Static/health routes must remain available after auth quota exhaustion.
  assert.equal((await fetch(`${base}/health/ready`)).status, 204);
  assert.equal((await fetch(`${base}/__review_failure?token=${secret}`, { headers })).status, 503);
  const log = docker(["exec", name, "cat", "/var/log/nginx/orbit-access.log"]);
  assert(!log.includes(secret));
  const rows = log.split("\n").filter(Boolean).map(line => JSON.parse(line));
  assert(rows.some(row => row.status === 429 && (row.rateLimit === "REJECTED" || row.connectionLimit === "REJECTED")));
  assert(rows.some(row => row.upstreamStatus === "204"));
  assert(rows.some(row => row.status === 503 && row.upstreamStatus === "503"));
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  const summary = { imageId, requests: responses.length, accepted: responses.filter(r => r.status === 204).length,
    rejected: rejected.length, secretAbsent: true, upstreamFailureVisible: true, upstreamTimingPresent: rows.some(row => row.upstreamResponseSeconds !== "-") };
  await writeFile(resolve(directory, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(resolve(directory, "access.jsonl"), log);
  console.log(JSON.stringify(summary));
} finally {
  if (created) docker(["rm", "--force", name]);
}
