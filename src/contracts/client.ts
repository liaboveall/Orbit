import { z } from "zod";
import {
  ErrorResponseSchema,
  MetaSchema,
  PageMetaSchema,
  type ErrorDetail,
  type Meta,
  type PageMeta,
} from "./envelope";

/**
 * API 客户端骨架（ORB-003，M0）。
 *
 * 职责：提供类型安全的 fetch 包装，自动解析统一信封（成功 `{data,meta}` / 列表 `{data[],meta}` /
 * 错误 `{error,meta}`），并把结果收敛为判别联合 `ApiResult`。M0 只实现骨架，不覆盖全部 endpoint。
 *
 * 边界（docs/03 §3、AGENTS.md）：
 *  - 本模块是**客户端代码**，可进入浏览器 bundle，绝不含 server-only / Prisma / @/server 依赖；
 *  - 会话靠同源 cookie，默认 `credentials:"same-origin"`；不把 token 放 localStorage；
 *  - 传输失败或信封不合法时抛 `ApiClientError`（不吞错误），业务错误则返回 `{ok:false,...}`。
 */

/** 可注入的 fetch 实现（便于测试替换，不依赖真实网络）。 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 查询参数初始值：undefined 会被跳过。 */
export type QueryInit = Record<string, string | number | boolean | undefined>;

/** 单次请求的可选配置。 */
export interface RequestOptions {
  query?: QueryInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 需要幂等的写操作携带 Idempotency-Key（UUID，docs/05 §5）。 */
  idempotencyKey?: string;
}

/** 客户端配置。 */
export interface ApiClientConfig extends RequestOptions {
  /** 基路径，默认 `/api/v1`（对齐 openapi servers[0].url）。 */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  credentials?: RequestCredentials;
}

export const DEFAULT_API_BASE_URL = "/api/v1";

/** 成功结果（单对象信封）。 */
export type ApiSuccess<T> = { ok: true; status: number; data: T; meta: Meta };
/** 成功结果（列表信封）。 */
export type ApiListSuccess<T> = { ok: true; status: number; data: T[]; meta: PageMeta };
/** 业务错误结果（标准错误信封）。 */
export type ApiFailure = { ok: false; status: number; error: ErrorDetail; meta: Meta };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
export type ApiListResult<T> = ApiListSuccess<T> | ApiFailure;

/** 传输层/信封不合法错误（非业务错误），例如网络失败、非 JSON、信封 schema 不匹配。 */
export class ApiClientError extends Error {
  readonly status: number | undefined;
  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    // cause 通过 ErrorOptions 交给基类持有（ES2022），避免重复声明需要 override。
    super(message, { cause: options.cause });
    this.name = "ApiClientError";
    this.status = options.status;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toSearchString(query: QueryInit | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** 拼接 baseUrl + path + query。允许 baseUrl 为相对路径（浏览器 fetch 支持）。 */
export function buildRequestUrl(baseUrl: string, path: string, query?: QueryInit): string {
  const base = trimTrailingSlash(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}${toSearchString(query)}`;
}

/** 类型安全的 Orbit API 客户端。 */
export interface ApiClient {
  get<T extends z.ZodType>(
    path: string,
    schema: T,
    options?: RequestOptions,
  ): Promise<ApiResult<z.output<T>>>;
  getList<T extends z.ZodType>(
    path: string,
    itemSchema: T,
    options?: RequestOptions,
  ): Promise<ApiListResult<z.output<T>>>;
  post<T extends z.ZodType>(
    path: string,
    schema: T,
    body: unknown,
    options?: RequestOptions,
  ): Promise<ApiResult<z.output<T>>>;
  patch<T extends z.ZodType>(
    path: string,
    schema: T,
    body: unknown,
    options?: RequestOptions,
  ): Promise<ApiResult<z.output<T>>>;
  delete<T extends z.ZodType>(
    path: string,
    schema: T,
    options?: RequestOptions,
  ): Promise<ApiResult<z.output<T>>>;
}

/** 创建一个 API 客户端。M0 骨架：泛型方法保证 data 类型由传入 schema 推导。 */
export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const baseUrl = config.baseUrl ?? DEFAULT_API_BASE_URL;
  const fetchImpl: FetchLike = config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const defaultHeaders = config.headers ?? {};
  const defaultQuery = config.query;
  const credentials = config.credentials ?? "same-origin";

  async function send<T extends z.ZodType>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    schema: T,
    body: unknown,
    options: RequestOptions | undefined,
    list: false,
  ): Promise<ApiResult<z.output<T>>>;
  async function send<T extends z.ZodType>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    schema: T,
    body: unknown,
    options: RequestOptions | undefined,
    list: true,
  ): Promise<ApiListResult<z.output<T>>>;
  async function send<T extends z.ZodType>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    schema: T,
    body: unknown,
    options: RequestOptions | undefined,
    list: boolean,
  ): Promise<ApiResult<z.output<T>> | ApiListResult<z.output<T>>> {
    const url = buildRequestUrl(baseUrl, path, { ...defaultQuery, ...options?.query });

    const headers: Record<string, string> = { ...defaultHeaders, ...options?.headers };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (options?.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        credentials,
        signal: options?.signal,
        body: payload,
      });
    } catch (cause) {
      throw new ApiClientError(`请求传输失败：${method} ${url}`, { cause });
    }

    const text = await response.text();

    // 业务错误：解析标准错误信封；不合法则视为传输/契约异常抛出。
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(safeJsonParse(text, response.status));
      if (!parsed.success) {
        throw new ApiClientError(`错误响应不符合统一信封（status=${response.status}）`, {
          status: response.status,
          cause: parsed.error,
        });
      }
      return {
        ok: false,
        status: response.status,
        error: parsed.data.error,
        meta: parsed.data.meta,
      };
    }

    const json = safeJsonParse(text, response.status);
    const envelope = readEnvelopeFields(json, response.status);

    // 列表信封：data 逐项由 schema 校验，meta 用具体的 PageMetaSchema。
    // （不用泛型 ListResponseSchema，避开泛型 strictObject 输出推断问题；语义等价。）
    if (list) {
      const itemsResult = z.array(schema).safeParse(envelope.data);
      if (!itemsResult.success) {
        throw new ApiClientError(`列表 data 不符合统一信封（status=${response.status}）`, {
          status: response.status,
          cause: itemsResult.error,
        });
      }
      const listMetaResult = PageMetaSchema.safeParse(envelope.meta);
      if (!listMetaResult.success) {
        throw new ApiClientError(`列表 meta 不符合统一信封（status=${response.status}）`, {
          status: response.status,
          cause: listMetaResult.error,
        });
      }
      return {
        ok: true,
        status: response.status,
        data: itemsResult.data,
        meta: listMetaResult.data,
      };
    }

    // 单对象信封：data 由 schema 校验，meta 用具体的 MetaSchema。
    const dataResult = schema.safeParse(envelope.data);
    if (!dataResult.success) {
      throw new ApiClientError(`成功响应 data 不符合统一信封（status=${response.status}）`, {
        status: response.status,
        cause: dataResult.error,
      });
    }
    const metaResult = MetaSchema.safeParse(envelope.meta);
    if (!metaResult.success) {
      throw new ApiClientError(`成功响应 meta 不符合统一信封（status=${response.status}）`, {
        status: response.status,
        cause: metaResult.error,
      });
    }
    return {
      ok: true,
      status: response.status,
      data: dataResult.data,
      meta: metaResult.data,
    };
  }

  return {
    get: (path, schema, options) => send("GET", path, schema, undefined, options, false),
    getList: (path, itemSchema, options) => send("GET", path, itemSchema, undefined, options, true),
    post: (path, schema, body, options) => send("POST", path, schema, body, options, false),
    patch: (path, schema, body, options) => send("PATCH", path, schema, body, options, false),
    delete: (path, schema, options) => send("DELETE", path, schema, undefined, options, false),
  };
}

/** 解析 JSON 文本；失败抛 ApiClientError（空 body 亦视为异常，204 端点不在骨架范围）。 */
function safeJsonParse(text: string, status: number): unknown {
  if (text.length === 0) {
    throw new ApiClientError(`响应体为空，无法解析统一信封（status=${status}）`, { status });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiClientError(`响应体不是合法 JSON（status=${status}）`, { status, cause });
  }
}

/** 从已解析的 JSON 中取出信封的 data / meta 字段（拒绝非对象信封）。 */
function readEnvelopeFields(json: unknown, status: number): { data: unknown; meta: unknown } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ApiClientError(`响应不是合法的信封对象（status=${status}）`, { status });
  }
  const envelope = json as Record<string, unknown>;
  return { data: envelope.data, meta: envelope.meta };
}
