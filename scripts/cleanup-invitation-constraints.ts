/** Read-only invitation consistency check. Never select tokens or user identifiers. */
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { maintenanceIntent } from "./lib/maintenance-target";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
async function main() {
  const intent = maintenanceIntent("invitation-inspect", process.argv.slice(2), process.env);
  if (intent.execute) throw new Error("This inspection is read-only");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const inconsistent = await prisma.invitation.count({ where: { OR: [
      { acceptedAt: { not: null }, acceptedById: null },
      { acceptedAt: null, acceptedById: { not: null } },
    ] } });
    console.log(JSON.stringify({ event: "invitation_consistency", inconsistent, target: intent.target }));
    if (inconsistent) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Invitation inspection failed; inspect configuration without logging secret values."); process.exitCode = 1; });
