import "server-only";
import busboy from "busboy";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { UploadAttachmentMetaSchema } from "@/contracts";
import { DomainError } from "@/server/http/errors";
import { MAX_ATTACHMENT_BYTES } from "@/server/modules/limits";
import { uploadAttachment, type UploadAttachmentResult } from "./service";

const invalid = () =>
  new DomainError(
    "VALIDATION_ERROR",
    "上传表单不合法，请按顺序提交元信息和单个文件。",
  );
/** 单次上传总时限（docs/05 §8）。 */
export const UPLOAD_DEADLINE_MS = 120_000;
const uploadTimedOut = () =>
  new DomainError("STORAGE_UNAVAILABLE", "上传超时，请检查网络后重新选择文件重试。");
const uploadInterrupted = () =>
  new DomainError("STORAGE_UNAVAILABLE", "上传已中断，请重新选择文件后重试。");
export async function uploadMultipart(
  request: Request,
  taskId: string,
  userId: string,
  options: { deadlineMs?: number } = {},
) {
  if (
    !request.body ||
    !request.headers.get("content-type")?.startsWith("multipart/form-data;")
  )
    throw invalid();
  const maxBody = MAX_ATTACHMENT_BYTES + 65536;
  if (Number(request.headers.get("content-length")) > maxBody)
    throw new DomainError("PAYLOAD_TOO_LARGE", "上传请求过大。");
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(options.deadlineMs ?? UPLOAD_DEADLINE_MS);
  const signal = AbortSignal.any([request.signal, deadline, controller.signal]);
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": request.headers.get("content-type")! },
      defParamCharset: "utf8",
      limits: {
        fields: 3,
        files: 1,
        parts: 5,
        fieldSize: 128,
        fieldNameSize: 32,
        fileSize: MAX_ATTACHMENT_BYTES + 1,
        headerPairs: 20,
      },
    });
  } catch {
    throw invalid();
  }
  let bytes = 0,
    operation: Promise<UploadAttachmentResult> | undefined,
    primary: unknown,
    // 业务服务的非领域错误（数据库不可用、池饱和等），交由 HTTP 层映射而非冒充表单错误。
    dependencyFailure: unknown;
  const fields: Record<string, string> = {};
  const order = ["uploadId", "declaredSizeBytes", "sha256"];
  const fail = (error: unknown) => {
    primary ??= error;
    controller.abort();
  };
  parser.on("field", (name, value, info) => {
    if (
      operation ||
      name !== order[Object.keys(fields).length] ||
      info.valueTruncated ||
      info.nameTruncated
    ) {
      fail(invalid());
      return;
    }
    fields[name] = value;
  });
  parser.on("file", (name, stream, info) => {
    // Rejected parts are still destroyed by busboy when the request aborts.
    // Attach an error listener before validation, including for parts never piped to disk.
    stream.on("error", fail);
    const parsed = UploadAttachmentMetaSchema.safeParse({
      ...fields,
      declaredSizeBytes: /^[1-9]\d*$/.test(fields.declaredSizeBytes ?? "")
        ? Number(fields.declaredSizeBytes)
        : 0,
    });
    if (
      name !== "file" ||
      operation ||
      !parsed.success ||
      Object.keys(fields).length !== 3
    ) {
      stream.resume();
      fail(invalid());
      return;
    }
    stream.on("limit", () =>
      fail(new DomainError("PAYLOAD_TOO_LARGE", "文件不能超过 10 MiB。")),
    );
    operation = uploadAttachment(
      taskId,
      userId,
      parsed.data,
      { fileName: info.filename, mimeType: info.mimeType, stream },
      { signal, complete: completion },
    );
    void operation.catch((error: unknown) => {
      if (!(error instanceof DomainError)) dependencyFailure ??= error;
      fail(error);
    });
  });
  parser.on("fieldsLimit", () => fail(invalid()));
  parser.on("filesLimit", () => fail(invalid()));
  parser.on("partsLimit", () => fail(invalid()));
  const source = Readable.fromWeb(request.body as NodeWebStream<Uint8Array>);
  const bound = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > maxBody
          ? new DomainError("PAYLOAD_TOO_LARGE", "上传请求过大。")
          : null,
        chunk,
      );
    },
  });
  const completion = pipeline(source, bound, parser, { signal });
  void completion.catch(fail);
  try {
    await completion;
    if (!operation) throw invalid();
    return await operation;
  } catch (error) {
    controller.abort();
    if (operation) await operation.catch(() => undefined);
    if (primary instanceof DomainError) throw primary;
    if (error instanceof DomainError) throw error;
    if (dependencyFailure !== undefined) throw dependencyFailure;
    // 超时/中断先于表单判定：停滞的慢网络不是「表单不合法」。
    if (deadline.aborted) throw uploadTimedOut();
    if (request.signal.aborted) throw uploadInterrupted();
    throw invalid();
  }
}
