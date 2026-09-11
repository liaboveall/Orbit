import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const original = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(original.hostname) || !original.pathname.endsWith("/orbit_test")) throw new Error("Local test database required");
original.hostname = "host.docker.internal";
const env = { ...process.env, APP_ENV: "test", DATABASE_URL: original.toString(), TEST_DATABASE_URL: original.toString(), APP_URL: "http://localhost:43128", BETTER_AUTH_URL: "http://localhost:43128", AUTH_TRUSTED_ORIGINS: "http://localhost:43128" };
const keys = ["APP_ENV", "DATABASE_URL", "TEST_DATABASE_URL", "APP_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "AUTH_TRUSTED_ORIGINS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "STORAGE_ENDPOINT", "STORAGE_REGION", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"];
const name = `orbit-m6-smoke-${randomUUID()}`;
function docker(args) {
  const result = spawnSync("docker", args, { env, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Container smoke operation failed");
  return result.stdout.trim();
}
let created = false;
try {
  docker(["run", "-d", "--name", name, "-p", "127.0.0.1:43128:3000", ...keys.flatMap(key=>["-e",key]), "orbit:m6"]); created=true;
  let ready=false;
  for(let i=0;i<30;i++) {
    try { const r=await fetch("http://localhost:43128/health/ready"); if(r.ok){ready=true;break;} } catch { /* bounded readiness retry */ }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error("Container not ready");
  const demo=await fetch("http://localhost:43128/demo");
  if(!demo.ok || !(await demo.text()).includes("校园活动报名系统"))throw new Error("Demo smoke failed");
  if(docker(["exec",name,"id","-u"])==="0")throw new Error("Root runtime forbidden");
  docker(["exec",name,"node","-e","if(require('fs').existsSync('/app/.env.local'))process.exit(1)"]);
  console.log(JSON.stringify({ready:true,demo:true,nonRoot:true,noBuildEnvironmentFile:true,image:docker(["inspect","--format","{{.Image}}",name])}));
} finally {if(created)docker(["rm","-f",name]);}
