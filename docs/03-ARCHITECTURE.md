# 03 · 技术架构

## 1. 技术决策

采用 Next.js 模块化单体。网页与 API 同源，业务层独立于 Route Handlers，后续可以拆出独立后端，但 V1 不为展示“全栈”重复搭建网关和服务。

| 层 | 基线 | 使用边界 |
|---|---|---|
| Runtime | Node.js 24 LTS、pnpm | 不用 Edge 运行数据库/附件处理 |
| Web | Next.js 16 App Router + 配套 React 稳定版 | public 页面/外壳服务端渲染，交互局部 client |
| Language | TypeScript strict | DTO 显式定义，不泄露 ORM 对象 |
| UI | Tailwind CSS、Radix primitives、Lucide | 以 tokens 为视觉源；只选一种组件原语体系 |
| Client data | RSC + createApiClient / API 直调 | 服务器组件直查为数据真源；写操作后 router.refresh()；分页用请求代次绑定防旧响应污染；筛选在 URL；草稿在局部状态，任务标题/描述另按用户在本机持久化以便恢复（生命周期见 §6） |
| Forms | React Hook Form + Zod | 与 API 校验共享限制，服务端仍重新校验 |
| Drag | @dnd-kit/core + sortable，选兼容版本 | 键盘/菜单替代、失败回滚 |
| Persistence | PostgreSQL 17 + Prisma 7 + PostgreSQL adapter | SQL 迁移补充 ORM 不支持的约束 |
| Auth | Better Auth + Prisma adapter | 邮箱密码、验证、重置、数据库会话 |
| Storage | 私有 S3 兼容 API | 本地/CI SeaweedFS，生产 S3 兼容供应商 |
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
    modules/                # 业务模块（attachments/storage、invitation、task 等）
    http/                   # 错误映射、origin 验证、请求 ID、限流
  lib/                      # 确实跨功能的纯工具，不能成为杂物目录
  styles/                   # tokens、globals
prisma/                     # schema、迁移、seed
tests/unit/ integration/ e2e/ contract/
scripts/                    # seed、清理、导出测试报告
Dockerfile / .dockerignore  # 仓库根目录（M6 容器构建）
infra/                      # compose、nginx、备份脚本、生命周期 JSON
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

## 6. 客户端状态和数据流

当前实现的数据真源是 **Server Component 直查**：页面在服务器组件里经领域服务读取权威数据，以 props 下发给客户端组件。客户端不维护第二套缓存真源；项目不依赖 TanStack Query（package.json 未包含，见 `src/features/shell/providers.tsx` 的数据真源说明）。V1 不为兑现历史规划强行引入 TanStack Query。服务端页面经 `requirePageUser()`（React `cache`，同一请求内布局与页面共享一次会话查询）取得会话，并在读取项目数据前消费一次读取额度，见 §8。

写操作通过 `createApiClient` 直调对应 `/api/v1` 端点；成功后调用 `router.refresh()` 让服务器组件重新读取权威数据，而非在客户端手动失效/合并缓存。因此不存在 query key、`invalidates`、`cancelQueries` 这类客户端缓存语义。

分页/无限滚动使用**请求代次绑定**（`generationRef`，见 `src/features/activity/ActivityFeed.tsx`、`src/features/projects/project-list-client.tsx`）：每次首屏重置或卸载递增代次，仍在飞行的旧响应落地时发现代次不匹配即整体丢弃，防止旧上下文响应污染新数据。dedupe-by-id 不足以防护来自不同筛选上下文的旧响应，故以代次为准。

草稿、弹窗、拖拽状态留在局部 React state；V1 不引入全局 Redux/Zustand。例外是任务标题/描述草稿：按 `orbit:draft:<userId>:<projectId>:<taskId>` 存于 localStorage 7 天，仅用于刷新、崩溃或会话过期后的恢复；恢复时所有待提交字段以编辑态可见，确认放弃/离开、保存成功、成功退出登录、换账号或失去项目访问时删除（`src/features/tasks/draft-storage.ts`）。评论、子任务草稿只在内存。打开中的任务被他人删除后，面板与独立页保留最后一次内容和草稿并切换为只读提示，不因后台刷新卸载编辑器。列表筛选、视图和打开任务 ID 在 URL 中；不把描述、评论、凭证写 URL。加载态用 skeleton，与过期（stale）内容区分。

## 7. 附件流程

1. 接收文件元信息并验证项目/任务、类型、配额；短事务内创建 UPLOADING 行和预留空间。
2. 服务端流式读取，限制字节数并检查文件头/UTF-8；使用不可猜测的对象 key 写入私有桶。不信任 Content-Length、扩展名或客户端 MIME。
3. 上传完成后再次短事务锁 Project 并重新授权；若期间成员退出、任务删除或项目归档则不发布附件，标记失败并清理对象。
4. 成功时更新 READY、实际大小、摘要，记活动。API 才返回成功。
5. 中断/失败释放预留、删除对象；清理失败记录待清理状态。维护命令回收超过 1 小时的 UPLOADING 和失败孤儿。
6. 下载先校验成员关系与任务未删除，再生成 60 秒 signed GET；强制下载，不直接渲染附件。

不实现先返回“成功”再异步猜测文件是否存在的流程；也不让浏览器提交任意 bucket/objectKey。V1 上传由持续运行 Node 服务承载，反向代理设置合适请求体上限，不能部署到不支持此大小的请求环境而不修改设计。

## 8. 错误、可观测性和限流

认证请求先按实际字节数执行 64KiB 有界读取，再交给 Better Auth 解析；无/偏小 Content-Length 不能绕过限制，超限统一返回 413。读取期间客户端 abort 取消源流；超限取消不等待不合作的源完成。

SMTP 每次发送使用独立可取消连接，TCP/greeting/空闲预算分别 10/10/15 秒，发送总预算 20 秒。总预算到期关闭真实 socket，不能只让 Promise 超时；保留 implicit TLS、生产强制 STARTTLS 和证书校验。同 env 并发发送互不取消。实现对照 [Nodemailer socket 选项](https://nodemailer.com/extras/smtp-connection) 与已安装 10.0.1 源码。

附件下载获取响应头预算 10 秒，整个响应流预算 120 秒；成功、截断、客户端取消及超时均释放计时器/监听。按存储声明长度检查实际字节，流开始后只结束流并留脱敏事件，不伪造新的 JSON 错误响应。

结构化日志分层：Nginx 安全访问日志记录 requestId、固定标签 route/method、status、bytes、durationSeconds，不记录路径、查询或 Referer，避免路径令牌泄露；代理覆盖 X-Request-Id 后传入应用用于关联。应用记录脱敏 errorClass/errorCode 和认证邮件事件，LOG_LEVEL 控制 debug/info/warn/error。业务 userId/projectId 仅在事件明确需要且完成授权后选取，禁止复制请求或错误原文。

staging/production 使用 PostgreSQL 共享原子固定窗口限流：业务写 60 次/用户/分钟、GET 读取 300 次/用户/分钟、邀请预览/接受合计 20 次/IP/分钟；认证使用 Better Auth 1.7.3 customStorage.consume，并保持敏感端点原阈值。上传采用数据库滑动分钟 10 次和最多 2 个跨副本活跃租约（180 秒，覆盖 120 秒请求截止）；development/test 保留内存实现，真实双池并发测试直接验证共享实现。只信任 TRUSTED_PROXY_COUNT 指定代理链，默认 0 退化共享来源桶。细节与维护见 [M6 运行手册](M6-OPERATIONS.md)。

服务端页面与 API 共用每用户读取额度：每个完整页面请求（首屏、客户端导航、刷新）在读取数据前计 1 次，同一请求的布局与页面只计一次；链接预取只渲染到布局、不执行页面，因此不计费（2026-09-24 实测预取载荷不含页面数据）。超额时跳转 /rate-limited 说明页，显示等待秒数并保留原地址。

注册、重发验证邮件、找回密码等匿名认证入口不在请求内等待 SMTP：发信 hook 立即返回，投递经 Next `after()` 在响应结束后执行（有界并发，积压上限后丢弃并记录 auth_email_dropped），投递失败只写脱敏 auth_email_failed，不改变匿名响应的状态、正文与耗时。进程被强制终止时尚未发出的认证邮件可能丢失，用户可重新发送。

连接池饱和时 Prisma 交互式事务在 maxWait（2 秒）内无法开始会抛出特定 P2028，与 pg-pool 等待超时一样映射为 503 SERVICE_UNAVAILABLE；其余 P2028 仍按 500 上报。

已提供 /health/live（进程可服务）和 /health/ready（数据库连接与迁移兼容），实现与测试见 M6 运行手册；不暴露版本、凭证、连接字符串。邮件/存储暂时不可用只影响对应操作，有独立可观测错误，不让整个看板持续 500。

## 9. V1.1 的扩展位置

AI 接口通过 server/integrations/ai 与 server/modules/ai-plan 接入，见 09。需要后台执行时独立 Node worker；选 PostgreSQL 作业租约，V1.1 小规模不默认引入 Redis。只有任务负载或部署需求出现明确证据，才新增队列基础设施。
