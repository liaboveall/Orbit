import type { PrismaClient } from "@/generated/prisma/client";
import { assertFixtureUsersOwned } from "./fixture-ownership";

/** Capture ownership before user deletion: reset identifiers contain random tokens. */
export async function cleanupAuthUsers(prisma: PrismaClient, runTag: string) {
  if (runTag.length < 8) throw new Error("Auth cleanup requires a unique run tag");
  await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { email: { contains: runTag } }, select: { id: true, createdAt: true },
    });
    await assertFixtureUsersOwned(users);
    await tx.verification.deleteMany({
      where: { OR: [
        { identifier: { contains: runTag } },
        { value: { in: users.map((user) => user.id) }, identifier: { startsWith: "reset-password:" } },
      ] },
    });
    await tx.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  });
}
