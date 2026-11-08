import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { m5Fixture } from "../support/m5-fixture";
import { createComment, deleteComment, listComments } from "../../src/server/modules/comments/service";
import { createInvitation } from "../../src/server/modules/invitation/service";
import { createSubtask } from "../../src/server/modules/subtask/service";
import { prisma } from "../../src/server/db/prisma";
import { createAuth } from "../../src/server/auth/options";
import { getEnv } from "../../src/server/env";
import { touchTaskUpdatedAt } from "../../src/server/modules/task/subresource";

// R01/R06/R07/R08: real handler and real database regressions.
test.each(["owner", "member"] as const)("%s deletion makes comment replay a tombstone and clears cached text", async (deleter) => {
  const f = await m5Fixture();
  try {
    const key = randomUUID(), input = { body: "audit synthetic comment" };
    const created = await createComment(f.taskId, f.member, input, key);
    await deleteComment(created.comment.id, f[deleter], created.comment.version);
    const listed = await listComments(f.taskId, f.member, {});
    expect(listed.comments[0]?.body).toBeNull();
    const replay = await createComment(f.taskId, f.member, input, key);
    expect(replay.replayed).toBe(true);
    expect(replay.comment.body).toBeNull();
    const cached = await prisma.idempotencyRecord.findMany({where:{resourceId:created.comment.id}});
    expect(JSON.stringify(cached.map(r=>r.responseBody))).not.toContain(input.body);
    expect(replay.comment.isDeleted).toBe(true);
  } finally { await f.cleanup(); }
});

test("UUID casing shares one comment/subtask/invitation idempotency and cursor namespace", async () => {
  const f = await m5Fixture();
  try {
    const ck = randomUUID(), ck2 = randomUUID(), sk = randomUUID(), ik = randomUUID();
    await createComment(f.taskId, f.member, { body: "same operation" }, ck);
    await createComment(f.taskId.toUpperCase(), f.member, { body: "same operation" }, ck);
    await createSubtask(f.taskId, f.member, { title: "same operation" }, sk);
    await createSubtask(f.taskId.toUpperCase(), f.member, { title: "same operation" }, sk);
    const inv1 = await createInvitation(f.owner, f.projectId, ik, 7);
    const inv2 = await createInvitation(f.owner, f.projectId.toUpperCase(), ik, 7);
    expect(inv2.replayed).toBe(true);
    expect(inv2.data.invitation.id).toBe(inv1.data.invitation.id);
    expect(await prisma.comment.count({ where: { taskId: f.taskId } })).toBe(1);
    expect(await prisma.subtask.count({ where: { taskId: f.taskId } })).toBe(1);
    expect(await prisma.invitation.count({ where: { projectId: f.projectId } })).toBe(1);
    await expect(createComment(f.taskId.toUpperCase(), f.member, {body:"different"}, ck)).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
    await expect(createSubtask(f.taskId.toUpperCase(), f.member, {title:"different"}, sk)).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
    await expect(createInvitation(f.owner, f.projectId.toUpperCase(), ik, 14)).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
    expect(await prisma.activityLog.count({where:{projectId:f.projectId,action:{in:["COMMENT_CREATED","SUBTASK_CREATED"]}}})).toBe(2);

    await createComment(f.taskId, f.member, { body: "second comment" }, ck2);
    const page1 = await listComments(f.taskId.toUpperCase(), f.member, { limit: 1 });
    expect(page1.hasMore).toBe(true);
    const page2 = await listComments(f.taskId.toLowerCase(), f.member, { limit: 1, cursor: page1.nextCursor ?? undefined });
    expect(page2.comments).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("untrusted forwarded IP rotation cannot bypass authentication limits", async () => {
  const env = getEnv();
  const auth = createAuth(prisma, { ...env, APP_ENV: "development", TRUSTED_PROXY_COUNT: 0 });
  const request = (ip: string) => auth.handler(new Request(env.BETTER_AUTH_URL + "/api/auth/sign-in/email", {
    method: "POST", headers: { origin: env.BETTER_AUTH_URL, "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email: "not-an-email", password: "invalid input only" }),
  }));
  const statuses: number[] = [];
  for (let i=0; i<11; i++) statuses.push((await request("192.0.2.201")).status);
  expect(statuses.slice(0,10)).toEqual(Array(10).fill(400));
  expect(statuses[10]).toBe(429);
  for (const ip of ["192.0.2.202", "192.0.2.203", "192.0.2.204"]) expect((await request(ip)).status).toBe(429);
});

test.each(["UTC", "Asia/Shanghai", "America/Los_Angeles"])("event times are invariant under database session %s", async (zone) => {
  const f = await m5Fixture();
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('TimeZone', ${zone}, true)`;
      await touchTaskUpdatedAt(tx, f.taskId);
      const stored = await tx.$queryRaw<Array<{ epoch: number }>>`SELECT (extract(epoch FROM "updatedAt") * 1000)::double precision AS epoch FROM "Task" WHERE id=${f.taskId}::uuid`;
      expect(Math.abs(stored[0]!.epoch - Date.now())).toBeLessThan(5000);
      // adapter-pg 7.10's timestamp parser assumes UTC text. Production pools
      // pin timezone=UTC; restore that contract before testing ORM decoding.
      await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`;
      const row = await tx.task.findUniqueOrThrow({ where: { id: f.taskId } });
      expect(Math.abs(row.updatedAt.getTime() - Date.now())).toBeLessThan(5000);
    });
  } finally { await f.cleanup(); }
});

test("application connections pin the timezone required by adapter-pg", async () => {
  const rows = await prisma.$queryRaw<Array<{ zone: string }>>`SELECT current_setting('TimeZone') AS zone`;
  expect(rows[0]?.zone).toBe("UTC");
});

test("trusted proxy selects the right hop and ignores forged internal headers", async () => {
  const env = getEnv();
  const auth = createAuth(prisma, { ...env, APP_ENV: "development", TRUSTED_PROXY_COUNT: 2 });
  const request = (prefix: string, client: string) => auth.handler(new Request(env.BETTER_AUTH_URL + "/api/auth/sign-in/email", {
    method: "POST", headers: { origin: env.BETTER_AUTH_URL, "content-type": "application/json", "x-forwarded-for": `${prefix}, ${client}, 192.0.2.10`, "x-orbit-auth-client-ip": randomUUID() },
    body: JSON.stringify({ email: "not-an-email", password: "invalid input only" }),
  }));
  for (let i=0; i<10; i++) expect((await request(`198.51.100.${i+1}`, "203.0.113.21")).status).toBe(400);
  expect((await request("198.51.100.200", "203.0.113.21")).status).toBe(429);
  expect((await request("198.51.100.201", "203.0.113.22")).status).toBe(400);
});
