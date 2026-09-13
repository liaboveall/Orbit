import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import assert from "node:assert/strict";
import { killProcessTree } from "./process-tree.mjs";

if (process.platform === "win32") throw Error("Run this POSIX check in a Linux container");
const sentinel = net.createServer();
await new Promise(resolve => sentinel.listen(0, "127.0.0.1", resolve));
const grandchild = "const n=require('node:net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));";
const parentCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});setInterval(()=>{},1000);`;
for (const reason of ["startup-timeout", "cancellation"]) {
  const child = spawn(process.execPath, ["-e", parentCode], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
  try {
    const [data] = await once(child.stdout, "data");
    const port = Number(data.toString().trim());
    const exited = once(child, "exit");
    killProcessTree(child);
    await exited;
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
    await new Promise(resolve => probe.close(resolve));
    assert.equal(sentinel.listening, true);
    console.log(JSON.stringify({ reason, childExited: true, grandchildPortReleased: true, unrelatedListenerPreserved: true }));
  } finally { killProcessTree(child); }
}
await new Promise(resolve => sentinel.close(resolve));
