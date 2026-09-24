import { buildErrorResponse } from "@/contracts";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { NO_STORE } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/v1/* 未知路径兜底（OI-13）。
 *
 * Next 路由优先级保证更具体的静态/动态段先于本 catch-all 匹配，因此既有
 * 路由行为不变；只有未匹配任何路由的 API 前缀请求落到此处。这些请求原本
 * 会穿透到 HTML not-found 页，对 API 客户端是错误的表示。此处统一返回
 * 契约错误信封 JSON 404（docs/05 §3 NOT_FOUND），携带 requestId，不泄露
 * 路径存在性信息。proxy.ts 已先对未认证请求返回 401；认证与否不影响 404 语义。
 */
function notFoundJson(request: Request): Response {
  const requestId = resolveRequestIdFromRequest(request);
  const body = buildErrorResponse("NOT_FOUND", "请求的资源不存在或不可访问。", { requestId });
  return new Response(JSON.stringify(body), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": NO_STORE,
      "x-request-id": requestId,
    },
  });
}

export async function GET(request: Request) {
  return notFoundJson(request);
}
export async function POST(request: Request) {
  return notFoundJson(request);
}
export async function PUT(request: Request) {
  return notFoundJson(request);
}
export async function PATCH(request: Request) {
  return notFoundJson(request);
}
export async function DELETE(request: Request) {
  return notFoundJson(request);
}
