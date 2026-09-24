import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import net from "node:net";
import assert from "node:assert/strict";

// Exercise Playwright's actual webServer teardown, including inherited pipes and a detached child.
// No browser or database is needed. Windows uses taskkill and cannot reproduce the POSIX bug.
if (process.platform === "win32") throw new Error("Run this check on Linux");
const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
const root = process.cwd();
const dir = await mkdtemp(resolve(root, ".web-server-lifecycle-"));
const sentinel = net.createServer();
await new Promise(resolve => sentinel.listen(0, "127.0.0.1", resolve));
const freePort = async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
try {
  for (const expectedExit of [0, 1]) {
    const port = await freePort();
    const pidFile = resolve(dir, "child.pid");
    const serverCode = `require('node:http').createServer((q,s)=>s.end('ready')).listen(${port},'127.0.0.1');`;
    await writeFile(resolve(dir, "server.mjs"), `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { killProcessTree } from ${JSON.stringify(new URL("./process-tree.mjs", import.meta.url).href)};
const child=spawn(process.execPath,['-e',${JSON.stringify(serverCode)}],{detached:true,stdio:'inherit'});
writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
process.on('SIGTERM',()=>{killProcessTree(child);process.exit(0)});
process.on('SIGINT',()=>{killProcessTree(child);process.exit(0)});
`);
    await writeFile(resolve(dir, "probe.spec.ts"), `import {test,expect} from '@playwright/test';test('server lifecycle',async({request})=>{expect((await request.get('http://127.0.0.1:${port}')).status()).toBe(${expectedExit === 0 ? 200 : 201});});`);
    await writeFile(resolve(dir, "playwright.config.ts"), `
import base from ${JSON.stringify(resolve(root, "playwright.config.ts"))};
export default {testDir:${JSON.stringify(dir)},reporter:'list',workers:1,retries:0,timeout:5000,
webServer:{...base.webServer,command:${JSON.stringify(`node "${resolve(dir, "server.mjs")}"`)},url:'http://127.0.0.1:${port}',timeout:10000,
...(process.env.ORBIT_REPRO_DEFAULT_SHUTDOWN ? {gracefulShutdown:undefined} : {})}};
`);
    const child = spawn(process.execPath, [cli, "test", "--config", resolve(dir, "playwright.config.ts")], {
      detached: true, stdio: ["ignore", "pipe", "pipe"], env: {...process.env, CI:"true"},
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      // The deliberately reproduced failure leaves this owned detached group alive.
      void readFile(pidFile, "utf8").then(pid => { try { process.kill(-Number(pid), "SIGKILL"); } catch {} });
    }, 15000);
    try {
      const code = await new Promise(resolve => child.once("close", resolve));
      assert.equal(timedOut, false, `Playwright teardown exceeded 15 seconds\n${output}`);
      assert.equal(code, expectedExit, output);
      const probe = net.createServer();
      await new Promise((resolve, reject) => {probe.once("error",reject);probe.listen(port,"127.0.0.1",resolve);});
      await new Promise(resolve => probe.close(resolve));
      assert.equal(sentinel.listening, true);
      console.log(JSON.stringify({expectedExit, playwrightExited:true, applicationPortReleased:true, unrelatedListenerPreserved:true}));
    } finally {
      clearTimeout(timer);
      try { process.kill(-Number(await readFile(pidFile, "utf8")), "SIGKILL"); } catch {}
    }
  }
} finally {
  await new Promise(resolve => sentinel.close(resolve));
  await rm(dir, {recursive:true,force:true});
}
