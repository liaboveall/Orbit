import { checkReadiness } from "@/server/modules/maintenance/readiness";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const ready = await checkReadiness();
  return Response.json({ status: ready ? "ready" : "unavailable" }, {
    status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" },
  });
}
