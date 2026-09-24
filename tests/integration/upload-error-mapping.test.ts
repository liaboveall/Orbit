import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DomainError, toErrorResponse } from "@/server/http/errors";

/**
 * 上传失败分类回归：超时、客户端中断与依赖故障不得冒充「上传表单不合法」。
 *
 * 前三类在进入业务服务之前或通过替身服务触发，不写数据库；表单错误作为对照保持 400。
 */

const serviceFailure = Object.assign(
  new Error("Transaction API error: Unable to start a transaction in the given time."),
  { code: "P2028" },
);

vi.mock("@/server/modules/attachments/service", () => ({
  uploadAttachment: vi.fn(async () => {
    throw serviceFailure;
  }),
}));

const { uploadMultipart } = await import("@/server/modules/attachments/multipart");

const boundary = "----orbit-upload-errors";
const field = (name: string, value: string) =>
  `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
const metadata = field("uploadId", randomUUID()) + field("declaredSizeBytes", "5") + field("sha256", "0".repeat(64));

function multipartRequest(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/v1/tasks/x/attachments", {
    method: "POST",
    body,
    duplex: "half",
    signal,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  } as RequestInit & { duplex: "half" });
}

/** 只发送前半段表单后停滞，模拟慢网络或断线。 */
function stalledBody(prefix: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(prefix)); } });
}

function completeBody(content: string): ReadableStream<Uint8Array> {
  const text = content + `--${boundary}--\r\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("upload unexpectedly succeeded");
}

describe("上传失败分类", () => {
  it("超过总时限的停滞上传返回超时（503），而非表单不合法", async () => {
    const error = await rejectionOf(uploadMultipart(multipartRequest(stalledBody(metadata)), randomUUID(), "user", { deadlineMs: 200 }));
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect((error as DomainError).message).toContain("超时");
  });

  it("客户端中断返回中断语义，而非表单不合法", async () => {
    const client = new AbortController();
    setTimeout(() => client.abort(), 100);
    const error = await rejectionOf(uploadMultipart(multipartRequest(stalledBody(metadata), client.signal), randomUUID(), "user"));
    expect(error).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect((error as DomainError).message).toContain("中断");
  });

  it("业务服务的依赖故障原样交给 HTTP 层映射（池饱和 → 503 SERVICE_UNAVAILABLE）", async () => {
    const body = completeBody(
      metadata + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n`,
    );
    const error = await rejectionOf(uploadMultipart(multipartRequest(body), randomUUID(), "user"));
    expect(error).toBe(serviceFailure);
    const response = toErrorResponse(error, "upload-errors");
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("元信息顺序错误仍是 400 表单错误（对照）", async () => {
    const body = completeBody(field("sha256", "0".repeat(64)) + field("uploadId", randomUUID()));
    const error = await rejectionOf(uploadMultipart(multipartRequest(body), randomUUID(), "user"));
    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
