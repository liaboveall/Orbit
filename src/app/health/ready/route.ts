import { prisma } from "@/server/db/prisma";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "RateLimitBucket" LIMIT 1`;
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
