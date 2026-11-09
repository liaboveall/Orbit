// Load generator for scripts/capacity-test.sh. Runs inside the disposable capacity stack
// and only ever talks to that stack's web service and database. It repeats the budget
// measurement of tests/e2e/m6-quality.spec.ts (10 concurrent, 1000 tasks, 1000 subtasks,
// 1000 comments), then runs a mixed workload with one signed-in worker per user.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import pg from "pg";

const base = "http://web:3000";
const origin = process.env.APP_URL;
const seconds = Number(process.env.CAPACITY_SECONDS ?? 90);
const workers = 10;
const output = "/capacity";
const password = `Capacity-${randomBytes(12).toString("hex")}`;
const uploadBytes = 2 * 1024 * 1024;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const headersFor = (session, extra = {}) => ({
  cookie: session.cookie,
  origin,
  "x-forwarded-for": session.ip,
  "x-forwarded-proto": "https",
  ...extra,
});

let buffer = [];
async function flush() {
  const lines = buffer.join("");
  buffer = [];
  if (lines) await appendFile(`${output}/samples.jsonl`, lines);
}

async function timed(kind, send) {
  const started = performance.now();
  let status = 0;
  let body;
  try {
    const response = await send();
    status = response.status;
    body = await response.arrayBuffer();
  } catch {
    status = 0;
  }
  buffer.push(`${JSON.stringify({ t: Date.now(), kind, status, ms: performance.now() - started })}\n`);
  return { status, body };
}

const json = body => JSON.parse(Buffer.from(body).toString("utf8"));

async function signUpAndIn(database, index) {
  const email = `capacity-${index}-${randomUUID().slice(0, 8)}@example.com`;
  const ip = `10.200.1.${index + 1}`;
  const common = { "content-type": "application/json", origin, "x-forwarded-for": ip, "x-forwarded-proto": "https" };
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: common, body: JSON.stringify({ email, password, name: `Capacity ${index}` }) });
  if (!signUp.ok) throw new Error(`sign-up failed: ${signUp.status}`);
  await signUp.arrayBuffer();
  await database.query('UPDATE "User" SET "emailVerified" = true WHERE email = $1', [email]);
  const signIn = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: common, body: JSON.stringify({ email, password }) });
  if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status}`);
  await signIn.arrayBuffer();
  const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const user = await database.query('SELECT id FROM "User" WHERE email = $1', [email]);
  return { cookie, ip, id: user.rows[0].id };
}

async function createJson(session, path, data) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: headersFor(session, { "content-type": "application/json", "Idempotency-Key": randomUUID() }), body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`POST ${path} failed: ${response.status}`);
  return (await response.json()).data;
}

async function seed(database, owner, members) {
  const project = await createJson(owner, "/api/v1/projects", { name: "Capacity", key: `CP${randomBytes(3).toString("hex").toUpperCase()}`, color: "BLUE" });
  await createJson(owner, `/api/v1/projects/${project.id}/tasks`, { title: "Capacity first task" });
  const rows = await database.query(`INSERT INTO "Task" (id,"projectId",number,"creatorId","assigneeId",title,position,status,"completedAt","updatedAt")
    SELECT gen_random_uuid(),$1,n,$2,$2,'性能样例 '||n,n*1024,
    CASE WHEN n%3=0 THEN 'DONE'::"TaskStatus" WHEN n%3=1 THEN 'TODO'::"TaskStatus" ELSE 'IN_PROGRESS'::"TaskStatus" END,
    CASE WHEN n%3=0 THEN now() ELSE NULL END,now() FROM generate_series(2,1000) n RETURNING id`, [project.id, owner.id]);
  await database.query('UPDATE "Project" SET "nextTaskNumber"=1001 WHERE id=$1', [project.id]);
  await database.query(`INSERT INTO "Subtask" (id,"taskId",title,"updatedAt") SELECT gen_random_uuid(),id,'验收检查',now() FROM "Task" WHERE "projectId"=$1`, [project.id]);
  await database.query(`INSERT INTO "Comment" (id,"taskId","authorId",body,"updatedAt") SELECT gen_random_uuid(),id,$2,'合成讨论',now() FROM "Task" WHERE "projectId"=$1`, [project.id, owner.id]);
  for (const member of members) await database.query('INSERT INTO "ProjectMember" ("projectId","userId") VALUES ($1,$2)', [project.id, member.id]);
  return { projectId: project.id, taskIds: rows.rows.map(row => row.id) };
}

async function budget(owner, projectId, taskIds) {
  for (let batch = 0; batch < 10; batch++) {
    await Promise.all(Array.from({ length: 10 }, () => timed("budget_read", () => fetch(`${base}/api/v1/projects/${projectId}/tasks?limit=100`, { headers: headersFor(owner), signal: AbortSignal.timeout(30000) }))));
  }
  for (let batch = 0; batch < 4; batch++) {
    await Promise.all(taskIds.slice(batch * 10, batch * 10 + 10).map((id, index) => timed("budget_write", () => fetch(`${base}/api/v1/tasks/${id}`, {
      method: "PATCH", headers: headersFor(owner, { "content-type": "application/json" }), body: JSON.stringify({ expectedVersion: 1, title: `已验证 ${batch}-${index}` }), signal: AbortSignal.timeout(30000),
    }))));
  }
  const board = await timed("budget_board", () => fetch(`${base}/api/v1/projects/${projectId}/board`, { headers: headersFor(owner), signal: AbortSignal.timeout(30000) }));
  await writeFile(`${output}/board.json`, JSON.stringify({ status: board.status, bytes: board.body?.byteLength ?? 0 }));
  await flush();
}

async function upload(session, taskId) {
  // Text content so the file-type check accepts it; random so the store cannot deduplicate.
  const bytes = Buffer.from(randomBytes(uploadBytes / 2).toString("hex"));
  const form = new FormData();
  form.set("uploadId", randomUUID());
  form.set("declaredSizeBytes", String(bytes.length));
  form.set("sha256", createHash("sha256").update(bytes).digest("hex"));
  form.set("file", new Blob([bytes], { type: "text/plain" }), "capacity.txt");
  const result = await timed("upload", () => fetch(`${base}/api/v1/tasks/${taskId}/attachments`, { method: "POST", headers: headersFor(session), body: form, signal: AbortSignal.timeout(130000) }));
  if (result.status !== 201) return;
  const attachment = json(result.body).data;
  const link = await timed("download_link", () => fetch(`${base}/api/v1/attachments/${attachment.id}/download`, { headers: headersFor(session), signal: AbortSignal.timeout(30000) }));
  if (link.status !== 200) return;
  const target = new URL(json(link.body).data.url, origin);
  await timed("download", () => fetch(`${base}${target.pathname}${target.search}`, { headers: headersFor(session), signal: AbortSignal.timeout(130000) }));
}

async function worker(index, session, projectId, pool, until) {
  const versions = new Map(pool.map(id => [id, 1]));
  let cursor = 0;
  let nextWrite = Date.now() + index * 200;
  let nextUpload = Date.now() + 1000 + index * 2000;
  await sleep(index * 40);
  while (Date.now() < until) {
    const now = Date.now();
    const id = pool[cursor++ % pool.length];
    if (now >= nextUpload) {
      nextUpload = now + 20000;
      await upload(session, id);
    } else if (now >= nextWrite) {
      nextWrite = now + 2000;
      const result = await timed("write", () => fetch(`${base}/api/v1/tasks/${id}`, {
        method: "PATCH", headers: headersFor(session, { "content-type": "application/json" }), body: JSON.stringify({ expectedVersion: versions.get(id), title: `负载 ${index}-${now}` }), signal: AbortSignal.timeout(30000),
      }));
      if (result.status === 200) versions.set(id, json(result.body).data.version);
    } else {
      const path = cursor % 3 === 0 ? `/api/v1/projects/${projectId}/board` : cursor % 3 === 1 ? `/api/v1/projects/${projectId}/tasks?limit=100` : `/api/v1/tasks/${id}`;
      await timed(cursor % 3 === 0 ? "read_board" : cursor % 3 === 1 ? "read_list" : "read_task", () => fetch(`${base}${path}`, { headers: headersFor(session), signal: AbortSignal.timeout(30000) }));
    }
    if (buffer.length > 200) await flush();
    await sleep(400);
  }
}

const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
await database.connect();
try {
  const owner = await signUpAndIn(database, 0);
  const members = [];
  for (let index = 1; index <= workers; index++) members.push(await signUpAndIn(database, index));
  const { projectId, taskIds } = await seed(database, owner, members);
  await budget(owner, projectId, taskIds);
  await writeFile(`${output}/mixed-start`, String(Date.now()));
  const until = Date.now() + seconds * 1000;
  await Promise.all(members.map((session, index) => worker(index, session, projectId, taskIds.slice(100 + index * 50, 150 + index * 50), until)));
  await flush();
  await writeFile(`${output}/mixed-end`, String(Date.now()));
  console.log(JSON.stringify({ event: "capacity_load_complete", users: members.length + 1, tasks: taskIds.length + 1 }));
} finally {
  await database.end();
}
