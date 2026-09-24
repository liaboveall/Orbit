import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const original = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(original.hostname) || !original.pathname.endsWith("/orbit_test")) throw new Error("Local test database required");
// Use the database container's private network on both Desktop and Linux Engine.
// Verify the configured local port really belongs to this synthetic database.
const dbContainer = process.env.ORBIT_SMOKE_DATABASE_CONTAINER ?? "orbit-postgres";
const inspection = spawnSync("docker", ["inspect", dbContainer], { encoding: "utf8", windowsHide: true });
if (inspection.status !== 0) throw new Error("Synthetic database container unavailable");
const db = JSON.parse(inspection.stdout)[0];
const published = db.NetworkSettings.Ports["5432/tcp"] ?? [];
if (!published.some(port => port.HostPort === (original.port || "5432") && ["127.0.0.1", "0.0.0.0"].includes(port.HostIp)))
  throw new Error("Configured local test port does not match the synthetic database container");
const network = process.env.ORBIT_SMOKE_NETWORK ?? Object.keys(db.NetworkSettings.Networks)[0];
if (!network || !db.NetworkSettings.Networks[network]) throw new Error("Synthetic service network unavailable");
const name = `orbit-m6-smoke-${randomUUID()}`;
const proxy = `${name}-db`;
original.hostname = proxy;
original.port = "5432";
const env = { ...process.env, APP_ENV: "test", DATABASE_URL: original.toString(), TEST_DATABASE_URL: original.toString(), APP_URL: "http://localhost:43128", BETTER_AUTH_URL: "http://localhost:43128", AUTH_TRUSTED_ORIGINS: "http://localhost:43128" };
const keys = ["APP_ENV", "DATABASE_URL", "TEST_DATABASE_URL", "APP_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "AUTH_TRUSTED_ORIGINS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "STORAGE_ENDPOINT", "STORAGE_REGION", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"];
function docker(args) {
  const result = spawnSync("docker", args, { env, encoding: "utf8", windowsHide: true, timeout: 60000 });
  if (result.status !== 0) throw new Error("Container smoke operation failed");
  return result.stdout.trim();
}
let created = false, proxyCreated = false;
try {
  const image = process.env.ORBIT_SMOKE_IMAGE ?? "orbit:m6";
  // A disposable TCP proxy makes the database outage independent of Docker's
  // published-port routing. Never stop the user's PostgreSQL container.
  const forward = `const net=require('node:net');net.createServer(client=>{const upstream=net.connect(5432,${JSON.stringify(dbContainer)});client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());client.pipe(upstream);upstream.pipe(client);}).listen(5432,'0.0.0.0');`;
  docker(["run", "-d", "--name", proxy, "--network", network, "--no-healthcheck", "--entrypoint", "node", image, "-e", forward]); proxyCreated=true;
  docker(["run", "-d", "--name", name, "--network", network, "-p", "127.0.0.1:43128:3000", ...keys.flatMap(key=>["-e",key]), image]); created=true;
  let ready=false;
  for(let i=0;i<30;i++) {
    try { const r=await fetch("http://localhost:43128/health/ready"); if(r.ok){ready=true;break;} } catch { /* bounded readiness retry */ }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error("Container not ready");
  const anonymous=await fetch("http://localhost:43128/api/v1/me");
  if(anonymous.status!==401)throw new Error("Anonymous API smoke failed");
  for(const path of ["/api/v1", "/api/v1/unknown/smoke"]) {
    const response=await fetch("http://localhost:43128"+path, {headers:{cookie:"better-auth.session_token=synthetic-invalid-smoke"}});
    if(response.status!==404 || (await response.json()).error.code!=="NOT_FOUND")throw new Error("API fallback smoke failed");
  }
  const demo=await fetch("http://localhost:43128/demo");
  if(!demo.ok || !(await demo.text()).includes("校园活动报名系统"))throw new Error("Demo smoke failed");
  if(docker(["exec",name,"id","-u"])==="0")throw new Error("Root runtime forbidden");
  docker(["exec",name,"node","-e","if(require('fs').existsSync('/app/.env.local'))process.exit(1)"]);
  docker(["stop", "--time", "1", proxy]);
  const unavailable=await fetch("http://localhost:43128/health/ready", {signal:AbortSignal.timeout(20000)});
  if(unavailable.status!==503)throw new Error("Readiness did not detect database outage");
  docker(["start", proxy]);
  let recovered=false;
  for(let i=0;i<15;i++) { const r=await fetch("http://localhost:43128/health/ready",{signal:AbortSignal.timeout(10000)}); if(r.ok){recovered=true;break;} await new Promise(r=>setTimeout(r,1000)); }
  if(!recovered)throw new Error("Readiness did not recover");
  console.log(JSON.stringify({databaseOutageDetected:true,databaseRecovered:true,anonymousApi:true,jsonFallback:true,ready:true,demo:true,nonRoot:true,noBuildEnvironmentFile:true,image:docker(["inspect","--format","{{.Image}}",name])}));
} finally {
  try { if(created)docker(["rm","-f",name]); }
  finally { if(proxyCreated)docker(["rm","-f",proxy]); }
}
