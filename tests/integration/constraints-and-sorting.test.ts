import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { listProjectTasks } from "@/server/modules/task/read";
import { listProjects } from "@/server/modules/project/read";
import { m5Fixture } from "../support/m5-fixture";

let f: Awaited<ReturnType<typeof m5Fixture>>;
beforeEach(async () => { f = await m5Fixture(); });
afterEach(async () => {
  if (f) {
    await prisma.invitation.deleteMany({ where: { projectId: f.projectId } });
    await f.cleanup();
  }
});

it("accepted invitation references restrict user deletion while both quota constraints remain", async () => {
  await prisma.invitation.create({ data: { projectId: f.projectId, createdById: f.owner, tokenHash: randomUUID().replaceAll("-", "").repeat(2),
    expiresAt: new Date(Date.now() + 60000), acceptedAt: new Date(), acceptedById: f.outsider } });
  await expect(prisma.user.delete({ where: { id: f.outsider } })).rejects.toMatchObject({ code: "P2003" });
  await expect(prisma.project.update({ where: { id: f.projectId }, data: { usedBytes: -1n } })).rejects.toThrow();
  await expect(prisma.project.update({ where: { id: f.projectId }, data: { reservedBytes: -1n } })).rejects.toThrow();
  const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`SELECT conname FROM pg_constraint WHERE conrelid = '"Project"'::regclass`;
  expect(constraints.map(row => row.conname)).toEqual(expect.arrayContaining(["non_negative_used", "non_negative_reserved"]));
  expect(constraints.some(row => row.conname === "Project_bytes_non_negative_check")).toBe(false);
});

it("1000-task sorting under ten concurrent readers is measured against the unchanged five-connection pool", async () => {
  await prisma.task.createMany({ data: Array.from({ length: 999 }, (_, i) => ({
    projectId: f.projectId, creatorId: f.owner, number: i + 2, title: `测量任务 ${i}`, position: BigInt((i + 2) * 1024),
    priority: (["NONE", "LOW", "MEDIUM", "HIGH"] as const)[i % 4],
    dueDate: i % 5 === 0 ? null : new Date(Date.UTC(2026, 8, 1 + i % 28)),
  })) });
  const measurements = [];
  for (const sort of ["updated_desc", "due_asc", "priority_desc"] as const) {
    await listProjectTasks(f.projectId, f.owner, { sort, limit: 30 });
    const samples: number[] = [];
    for (let batch = 0; batch < 3; batch++) {
      await Promise.all(Array.from({ length: 10 }, async () => {
        const start = performance.now();
        const result = await listProjectTasks(f.projectId, f.owner, { sort, limit: 30 });
        expect(result.tasks).toHaveLength(30);
        expect(result.hasMore).toBe(true);
        samples.push(performance.now() - start);
      }));
    }
    samples.sort((a, b) => a - b);
    expect(samples[28], `${sort} p95 must meet the 300ms read budget`).toBeLessThanOrEqual(300);
    measurements.push({ sort, count: samples.length, p50Ms: samples[14], p95Ms: samples[28], maxMs: samples.at(-1), errors: 0 });
  }
  const due = await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, "dueDate" FROM "Task" WHERE "projectId" = ${f.projectId}::uuid AND "deletedAt" IS NULL ORDER BY "dueDate" ASC NULLS LAST, id ASC LIMIT 31`;
  const priority = await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, priority FROM "Task" WHERE "projectId" = ${f.projectId}::uuid AND "deletedAt" IS NULL ORDER BY priority DESC, id DESC LIMIT 31`;
  const projects = await listProjects(f.member, { scope: "joined", limit: 6 });
  expect(projects.projects.map(project => project.id)).toContain(f.projectId);
  expect((await listProjects(f.outsider, { scope: "all", limit: 6 })).projects).toHaveLength(0);
  await mkdir("artifacts/comprehensive-20260913", { recursive: true });
  await writeFile("artifacts/comprehensive-20260913/database-performance.json", JSON.stringify({
    environment: "local PostgreSQL; synthetic single project; not micro production capacity", poolMax: process.env.DATABASE_POOL_MAX ?? 5,
    measurements, plans: { due, priority },
  }, null, 2));
}, 30000);
