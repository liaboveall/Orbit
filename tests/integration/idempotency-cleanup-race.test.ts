import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { beginIdempotency, commitIdempotency, hashRequest } from "@/server/modules/idempotency/service";

test("过期记录被维护删除后，已读到旧记录的事务继续创建，不报 P2025 且不双写", async () => {
  const userId = randomUUID(), key = randomUUID();
  await prisma.user.create({ data: { id: userId, name: "race fixture", email: `race-${userId}@orbit.test` } });
  const opts = { userId, key, method: "POST", routeKey: "race-test", requestHash: hashRequest({ value: 1 }) };
  await prisma.idempotencyRecord.create({ data: { ...opts, responseStatus: 201, responseBody: { value: 0 }, expiresAt: new Date(0) } });
  try {
    await prisma.$transaction(async tx => {
      const delegate = new Proxy(tx.idempotencyRecord, {
        get(target, property, receiver) {
          if (property !== "findUnique") return Reflect.get(target, property, receiver);
          return async (...args: Parameters<typeof target.findUnique>) => {
            const found = await target.findUnique(...args);
            if (found?.userId === userId) {
              // Barrier after the real SELECT: delete on a second connection.
              await prisma.$executeRaw`DELETE FROM "IdempotencyRecord" WHERE id=${found.id}::uuid AND "expiresAt" < now()`;
            }
            return found;
          };
        },
      });
      const instrumented = new Proxy(tx, {
        get(target, property, receiver) {
          return property === "idempotencyRecord" ? delegate : Reflect.get(target, property, receiver);
        },
      });
      expect(await beginIdempotency(instrumented, opts)).toEqual({ kind: "new" });
      await commitIdempotency(tx, { ...opts, responseStatus: 201, responseBody: { value: 1 } });
    });
    const rows = await prisma.idempotencyRecord.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.responseBody).toEqual({ value: 1 });
  } finally {
    await prisma.idempotencyRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
