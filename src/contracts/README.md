# src/contracts · 契约层

Zod schema、DTO、错误码、校验帮助函数与 API 客户端骨架。**无服务端依赖**（无 `server-only`、
`@prisma/client`、`@/server`、`@/generated`），可在客户端与服务端共享校验规则（见 docs/03 §3）。
服务端仍会对所有外部输入重新校验；前端隐藏不构成权限控制。

- 传输结构以 [`contracts/openapi.json`](../../contracts/openapi.json) 为准；文字语义见 docs/05。
- ORB-003 已实现契约基础，模块划分：

| 文件 | 职责 |
|---|---|
| `primitives.ts` | 共享原子字段 schema（requestId、cursor、uuid、ISO 日期时间、version 等） |
| `enums.ts` | 全部枚举：`as const` 元组 + Zod schema + 联合类型（对齐 openapi enum） |
| `error-codes.ts` | docs/05 §3 错误码全表、`ErrorCode → HttpStatus` 类型安全映射 |
| `envelope.ts` | 统一信封：`Meta` / `PageMeta` / `Error` / `SuccessResponse<T>` / `ListResponse<T>` |
| `dto.ts` | 核心 DTO 与请求/查询 schema（User、Project、Task、Comment、Attachment、Activity…） |
| `helpers.ts` | `parseRequestBody` / `parseQueryParams` / `buildErrorResponse` / `buildSuccessResponse` / `buildListResponse` |
| `client.ts` | 类型安全 fetch 客户端骨架，自动解析成功/错误信封（GET/POST/PATCH/DELETE） |
| `index.ts` | 统一导出入口 |

契约测试位于 [`tests/contract`](../../tests/contract)：schema 正反例/边界、错误码全表、
Zod ↔ OpenAPI 字段名与枚举一致性、以及服务端/客户端边界守护。
