# 03 · 技术架构

## 1. 技术决策

采用 Next.js 模块化单体。网页与 API 同源，业务层独立于 Route Handlers，后续可以拆出独立后端，但 V1 不为展示“全栈”重复搭建网关和服务。

| 层 | 基线 | 使用边界 |
|---|---|---|
| Runtime | Node.js 24 LTS、pnpm | 不用 Edge 运行数据库/附件处理 |
| Web | Next.js 16 App Router + 配套 React 稳定版 | public 页面/外壳服务端渲染，交互局部 client |
| Language | TypeScript strict | DTO 显式定义，不泄露 ORM 对象 |
| UI | Tailwind CSS、Radix primitives、Lucide | 以 tokens 为视觉源；只选一种组件原语体系 |
| Client data | TanStack Query | 服务器状态缓存；筛选在 URL，草稿在局部状态 |
| Forms | React Hook Form + Zod | 与 API 校验共享限制，服务端仍重新校验 |
| Drag | @dnd-kit/core + sortable，选兼容版本 | 键盘/菜单替代、失败回滚 |
| Persistence | PostgreSQL 17 + Prisma 7 + PostgreSQL adapter | SQL 迁移补充 ORM 不支持的约束 |
| Auth | Better Auth + Prisma adapter | 邮箱密码、验证、重置、数据库会话 |
| Storage | 私有 S3 兼容 API | 本地 MinIO，生产 S3 兼容供应商 |
| Email | SMTP adapter | 本地 Mailpit，生产已配置的邮件服务 |
| Testing | Vitest、Playwright | 真 PostgreSQL 做集成测试 |
| CI/deploy | GitHub Actions、Docker | 单一标准 Node 容器部署路径 |

M0 读取官方版本资料并记录实际依赖到 docs/versions.md（由开发 Agent 创建），提交 pnpm-lock.yaml。上述是选定主版本，不声称全部都是当日最新。Prisma 7 使用相应生成器、driver adapter 和配置文件，不抄 Prisma 6/8 API。若兼容性验证失败，记录具体错误与最小替代决策，不无故整体换栈。

## 2. 结构

~~~mermaid
flowchart LR
    B[浏览器 / React] -->|同源 HTTPS / JSON| R[Next.js Route Handlers]
    S[Server Components] --> A[会话与授权]
    R --> A
    A --> D[领域服务]
    D --> P[Prisma / SQL 事务]
    P --> DB[(PostgreSQL)]
    D --> F[附件适配器]
    F --> O[(私有对象存储)]
    AU[Better Auth] --> DB
    AU --> M[邮件适配器]
    M --> SMTP[Mailpit / SMTP]
    C[维护命令] --> DB
    C --> O
~~~

## 3. 预期目录（M0 建立）

~~~text
src/
  app/                     # 页面和 /api/v1；auth 挂 /api/auth
  components/ui/           # 通用视觉原语
  features/
    auth/ projects/ tasks/ board/ comments/ files/ activity/ today/
  contracts/               # Zod schema、DTO、错误码；无服务端依赖
  server/
    auth/                   # Better Auth、会话、项目授权
    db/                     # Prisma singleton、事务帮助函数
    modules/                # project/task/invite/comment/file 等服务
    integrations/           # storage、mail、未来 AI provider
    http/                   # 错误映射、origin 验证、请求 ID、限流
  lib/                      # 确实跨功能的纯工具，不能成为杂物目录
  styles/                   # tokens、globals
prisma/                     # schema、迁移、seed
tests/unit/ integration/ e2e/ contract/
scripts/                    # seed、清理、导出测试报告
infra/                      # compose、Dockerfile、部署说明
artifacts/                  # 实际报告与截图（大文件按需忽略）
docs/ planning/ prompts/ contracts/  # 本规划
~~~

不预创建几十个空服务。只在当前里程碑需要时创建模块。server-only 保护含凭证、数据库和内部授权逻辑的模块。

## 4. 请求生命周期

业务 API：请求 ID → 验证 Origin/Content-Type/大小/限流 → 会话检查 → schema 校验 → 确定所属项目 → 领域服务内再次授权 → 事务 → DTO → 统一响应。

项目写操作统一在短事务里锁定 Project 行，重新检查 archived 状态与成员权限，再修改资源。统一锁顺序 User（仅影响owner项目配额的创建/归档/恢复）→ Project → Task → 子资源，避免配额、成员退出与任务分配竞争。普通任务写无需User锁。V1 的人数/规模下接受同项目写操作串行化，优先正确性；不同项目仍可并发。不得在持锁期间请求 SMTP、S3 或 AI。

业务失败抛领域错误，HTTP 层负责映射；不把 SQL 错误、堆栈或第三方响应直接返回用户。Server Components 可直接调用同一授权查询服务，不通过服务器 HTTP 绕一圈，也不能跳过权限。

## 5. 认证和安全边界

会话使用 Better Auth 数据库会话与安全 cookie；生产 Secure、HttpOnly、SameSite=Lax，使用库支持的设置，不手动伪造 cookie。不要将 session token 放 localStorage。

所有自有变更 API 仅接受同源浏览器请求，检查 Origin 与配置的可信源；缺失/不匹配 Origin 拒绝。JSON 请求要求 application/json，上传要求 multipart/form-data。库自有 auth 路由使用其内置 CSRF/可信源控制，不包一层破坏回调的自制逻辑。测试客户端同样发送合法 Origin。

组件路由重定向只是体验，数据安全在服务端授权。对非成员返回 404，项目成员执行超权限操作返回 403。资源 ID 不构成权限证明。响应、服务端页面和签名链接不进入公共 CDN 缓存。

V1 不引入数据库 RLS；所有查询必须经过项目授权服务，并用越权集成测试证明隔离。后续如果引入直接客户端访问数据库，必须重新设计授权，不能沿用此假设。

## 6. 客户端状态和缓存

Query key 包含当前 userId 和完整过滤条件，例如 ['tasks', userId, projectId, filters]，不能只用 ['tasks']。登出、换账号、发现权限失效时清空私有缓存。

草稿、弹窗、拖拽状态留在局部 React state；V1 不引入全局 Redux/Zustand。列表筛选、视图和打开任务 ID 在 URL 中；不把描述、评论、凭证写 URL。

任务更新后 invalidates：当前详情、相关项目列表与看板、我的任务/统计、活动；评论与子任务另刷新对应计数。附件完成后刷新附件和任务计数。浏览器可见时 30 秒轮询活跃项目，失焦停止；聚焦后刷新。生成 UI skeleton 和 stale 内容区分。

乐观更新适用于短时状态变更和拖拽。保存前 cancelQueries → 保存快照 → 更新缓存 → 失败恢复 → 成功后重新获取权威数据。同项目 move 串行，防止快照回滚覆盖后续移动。描述编辑保留独立草稿，不被后台响应覆盖。

## 7. 附件流程

1. 接收文件元信息并验证项目/任务、类型、配额；短事务内创建 UPLOADING 行和预留空间。
2. 服务端流式读取，限制字节数并检查文件头/UTF-8；使用不可猜测的对象 key 写入私有桶。不信任 Content-Length、扩展名或客户端 MIME。
3. 上传完成后再次短事务锁 Project 并重新授权；若期间成员退出、任务删除或项目归档则不发布附件，标记失败并清理对象。
4. 成功时更新 READY、实际大小、摘要，记活动。API 才返回成功。
5. 中断/失败释放预留、删除对象；清理失败记录待清理状态。维护命令回收超过 1 小时的 UPLOADING 和失败孤儿。
6. 下载先校验成员关系与任务未删除，再生成 60 秒 signed GET；强制下载，不直接渲染附件。

不实现先返回“成功”再异步猜测文件是否存在的流程；也不让浏览器提交任意 bucket/objectKey。V1 上传由持续运行 Node 服务承载，反向代理设置合适请求体上限，不能部署到不支持此大小的请求环境而不修改设计。

## 8. 错误、可观测性和限流

结构化日志字段：requestId、route、method、status、durationMs、userId（内部ID）、projectId（授权后）、errorCode。敏感字段统一 redact；不记录密码、cookie、token、请求正文或 signed URL。

PostgreSQL 支持共享限流计数，避免单进程内存限流在多副本失效。初始目标：常规业务写 60 次/用户/分钟、上传 10 次/用户/分钟且同时最多 2 个、邀请预览/接受 20 次/IP/分钟；认证按库配置单独限制。读取 300 次/用户/分钟。只信任已配置代理提供的客户端 IP。阈值为产品默认，可由配置下调，不由客户端设置。

提供 /health/live（进程可服务）和 /health/ready（数据库连接与迁移兼容）；不暴露版本、凭证、连接字符串。邮件/存储暂时不可用只影响对应操作，有独立可观测错误，不让整个看板持续 500。

## 9. V1.1 的扩展位置

AI 接口通过 server/integrations/ai 与 server/modules/ai-plan 接入，见 09。需要后台执行时独立 Node worker；选 PostgreSQL 作业租约，V1.1 小规模不默认引入 Redis。只有任务负载或部署需求出现明确证据，才新增队列基础设施。
