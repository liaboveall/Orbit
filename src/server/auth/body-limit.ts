import "server-only";

export const AUTH_BODY_LIMIT_BYTES = 64 * 1024;

function payloadTooLarge(): Response {
  return Response.json({ message: "请求体超过大小限制。" }, {
    status: 413,
    headers: { "cache-control": "private, no-store" },
  });
}

/** Better Auth turns parser stream errors into 500s. Validate the bounded body
 * before invoking it: retain at most 64KiB and never clone an unbounded stream. */
export function withAuthGuards(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > AUTH_BODY_LIMIT_BYTES) {
      void request.body?.cancel().catch(() => undefined);
      return payloadTooLarge();
    }
    if (!request.body) return handler(request);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      request.signal.throwIfAborted();
      while (true) {
        const { done, value } = await reader.read();
        request.signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > AUTH_BODY_LIMIT_BYTES) {
          cancel(); // Do not await an uncooperative source's cancellation.
          return payloadTooLarge();
        }
        chunks.push(value);
      }
    } finally {
      request.signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const headers = new Headers(request.headers);
    headers.set("content-length", String(size));
    return handler(new Request(request, { body: bytes, headers, signal: request.signal }));
  };
}
