"use client";

import { loginPathWithReturnTo } from "@/lib/return-to";

/**
 * M5 前端功能层共享的客户端 API 助手。
 *
 * 为什么存在（而非只用 `@/contracts` 的 createApiClient）：
 *  - 契约里所有 DELETE 返回 204 无响应体，而共享 api client 的 send() 遇到空 body 会抛
 *    ApiClientError（它面向「必有信封」的读写端点）。故删除走原生 fetch，把 204 视为成功。
 *  - 附件上传是 multipart/form-data，且需要真实上传进度；共享 client 只发 JSON，
 *    故上传走 XMLHttpRequest（uploadAttachment）。
 *
 * 边界：本模块是客户端代码，仅依赖同源 cookie 会话（credentials:"same-origin"），
 * 不构造/读取任何 token；隐藏按钮不构成权限控制，服务端始终重新校验（AGENTS.md、docs/03）。
 */

/** 对齐 openapi servers[0].url 与 contracts client 的默认基路径。 */
export const API_BASE = "/api/v1";

export type DeleteOk = { ok: true };
export type DeleteErr = { ok: false; status: number; code?: string; message: string };
export type DeleteResult = DeleteOk | DeleteErr;

function toQueryString(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * 发起返回 204 的删除请求。成功（204）→ {ok:true}；业务错误 → 解析统一错误信封。
 * 不吞网络异常：调用方需 try/catch 以覆盖「无法连接服务器」态。
 */
export async function apiDelete(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<DeleteResult> {
  const response = await fetch(`${API_BASE}${path}${toQueryString(query)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (response.status === 204 || response.ok) return { ok: true };

  let code: string | undefined;
  let message = "操作失败，请稍后重试。";
  try {
    const json = (await response.json()) as { error?: { code?: string; message?: string } };
    code = json.error?.code;
    if (json.error?.message) message = json.error.message;
  } catch {
    /* 非 JSON 错误体：保留兜底文案。 */
  }
  return { ok: false, status: response.status, code, message };
}

/**
 * 401 时跳转登录并带回 returnTo；返回是否已发起跳转，供调用方短路后续 UI 更新。
 * 与 task-editor.tsx 的会话失效处理保持一致。
 */
export function redirectToLoginIfUnauthenticated(status: number): boolean {
  if (status === 401 && typeof window !== "undefined") {
    window.location.assign(loginPathWithReturnTo(location.pathname + location.search));
    return true;
  }
  return false;
}

export type UploadOk = { ok: true; status: number; data: unknown };
export type UploadErr = { ok: false; status: number; code?: string; message: string };
export type UploadResult = UploadOk | UploadErr;

/**
 * 通过 XMLHttpRequest 发起 multipart 附件上传，回调真实上传进度（0..1）。
 * 用 XHR 而非 fetch，是因为 fetch 无法读取上传进度；表单字段顺序由调用方按契约装配
 * （uploadId → declaredSizeBytes → sha256 → file，docs/05 §8）。
 *
 * 成功（2xx）→ {ok:true, data}；业务错误 → 解析统一错误信封；网络失败/中止 → reject，
 * 调用方 try/catch 覆盖「无法连接服务器」与用户取消。
 */
export function uploadAttachment(
  taskId: string,
  form: FormData,
  handlers: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/tasks/${taskId}/attachments`);
    xhr.withCredentials = true;

    if (handlers.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) handlers.onProgress!(event.loaded / event.total);
      };
    }

    xhr.onload = () => {
      let json: { data?: unknown; error?: { code?: string; message?: string } } | undefined;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* 非 JSON：按兜底错误处理。 */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, status: xhr.status, data: json?.data });
        return;
      }
      resolve({
        ok: false,
        status: xhr.status,
        code: json?.error?.code,
        message: json?.error?.message ?? "上传失败，请稍后重试。",
      });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

    if (handlers.signal) {
      if (handlers.signal.aborted) {
        xhr.abort();
      } else {
        handlers.signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
    }

    xhr.send(form);
  });
}

/**
 * 把错误码/状态映射为面向用户的中文文案。未识别时回退到服务端 message 或传入兜底。
 * 只做 UX 分支，权限判断仍以服务端为准。
 */
export function messageForError(
  code: string | undefined,
  status: number,
  fallback = "操作失败，请稍后重试。",
): string {
  switch (code) {
    case "FORBIDDEN":
      return "你没有权限执行此操作。";
    case "NOT_FOUND":
      return "内容不存在或已被删除，列表将刷新。";
    case "VERSION_CONFLICT":
      return "内容已被他人更新，请查看最新版本后再操作。";
    case "PAYLOAD_TOO_LARGE":
      return "文件超过 10 MiB 单文件上限。";
    case "UNSUPPORTED_FILE_TYPE":
      return "不支持的文件类型。";
    case "LIMIT_EXCEEDED":
      return "已达数量或存储配额上限。";
    case "UPLOAD_IN_PROGRESS":
      return "已有相同文件正在上传，请稍候。";
    case "PROJECT_ARCHIVED":
      return "项目已归档，无法修改。";
    case "RATE_LIMITED":
      return "操作过于频繁，请稍后再试。";
    case "STORAGE_UNAVAILABLE":
    case "SERVICE_UNAVAILABLE":
      return "服务暂时不可用，请稍后重试。";
    default:
      if (status >= 500) return "服务器出错了，请稍后重试。";
      return fallback;
  }
}
