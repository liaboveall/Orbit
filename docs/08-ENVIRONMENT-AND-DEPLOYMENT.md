# 08 · 环境、CI 与部署

## 1. 本地开发目标

仓库根为 Orbit。M0提供 package.json、锁文件、Docker Compose 和实际启动文档。这些运行文件已实现；下列命令与 package.json 对齐，实际验证结果以 PROGRESS.md 为准。

环境要求：Node.js24 LTS、pnpm兼容稳定版本、Docker/Compose（或等价独立PostgreSQL、MinIO、Mailpit）。不自动假设用户安装了Docker；M0先检查，缺少时说明具体安装/启动步骤，仍可完成独立的规格与UI工作。

推荐本地端口：应用3000、PostgreSQL5432、MinIO API9000/控制台9001、Mailpit SMTP 宿主25025→容器1025/Web8025。只绑定localhost。Mailpit SMTP 宿主端口用25025而非1025：Windows 动态/临时端口区间（约1024–15000）会随机占用1025导致bind失败；`.env.local`/`.env.example` 的 SMTP_PORT 须与宿主端口一致（25025），容器内Mailpit始终监听1025（`compose.dev.yml` 映射 `${MAILPIT_SMTP_HOST_PORT:-25025}:1025`）。测试使用独立数据库orbit_test和独立对象前缀，不复用orbit_dev的数据（`pnpm test:e2e` 的具体实现见本节下方「E2E 测试环境隔离」）。

~~~text
pnpm install --frozen-lockfile
docker compose -f infra/compose.dev.yml up -d
pnpm db:migrate:dev
pnpm db:seed
pnpm dev
~~~

首次锁文件尚不存在时，M0使用正常安装生成锁文件；之后CI固定 frozen-lockfile。用户复制.env.example为.env.local并填写本地值。Prisma CLI、seed、维护脚本须显式加载同一约定环境文件，不能只有Next能读.env.local而CLI读不到。不同脚本不得静默回落到生产数据库。

## 2. 预定脚本

| 命令 | 责任 |
|---|---|
| pnpm dev | 启动开发web |
| pnpm build / start | 构建/运行生产web |
| pnpm lint / typecheck | ESLint与TS严格检查，lint使用独立CLI |
| pnpm test:unit | 纯逻辑与组件必要测试 |
| pnpm test:contract | OpenAPI/Zod/业务响应契约 |
| pnpm test:integration | 独立PostgreSQL上的API/事务/权限测试 |
| pnpm test:e2e | Playwright核心流程，仅启动独立测试服务，禁止复用 |
| pnpm check | lint、typecheck、unit、contract；integration/e2e在CI另执行 |
| pnpm db:migrate:dev | 仅开发库创建/应用迁移 |
| pnpm db:migrate:deploy | 按环境应用已审阅迁移 |
| pnpm db:seed | 幂等写入开发fixture |
| pnpm cleanup:attachments | M5 已实现：限批处理失效上传与待删除附件，失败可重试 |
| pnpm maintenance:cleanup | M6 待实现：统一清理过期幂等记录/限流桶等 |
| pnpm worker:ai | M7才提供的持久AI任务worker |

开发Agent负责让名称和实际行为一致。如果使用不同命令，同步README/AGENTS/CI，不能只改package.json。

### E2E 测试环境隔离（A10，2026-09-10）

`pnpm test:e2e` 不再直接 `next build && next start`（会加载 `.env.local` 的
`DATABASE_URL`，指向开发库 orbit_dev）。当前实现：

1. `playwright.config.ts` 的 `webServer.command` 改为
   `pnpm run build && node scripts/e2e-server.mjs`；应用端口默认 `E2E_PORT=3100`
   （与开发服务器默认的 3000 分开，防止 Playwright 静默复用一个正在跑的开发
   服务器）；`reuseExistingServer` 固定为 `false`（从不静默复用）。
2. `scripts/e2e-server.mjs` 在真正 spawn `next start` 前做三项前置校验，任一失败
   立即非零退出、不启动：`TEST_DATABASE_URL` 必须指向本机且数据库名与
   `DATABASE_URL`（开发库）不同名；实际连接该库确认可达且 `_prisma_migrations`
   已有完成记录（防止指向一个从未迁移的空库）；目标端口必须空闲（防止「端口
   已被占用」被误判为「服务已就绪」）。通过后把
   `DATABASE_URL`/`TEST_DATABASE_URL`/`APP_URL`/`BETTER_AUTH_URL`/
   `AUTH_TRUSTED_ORIGINS`/`PORT`/`APP_ENV=test` 作为**子进程环境变量**传给
   `next start`——按 Next.js 官方文档的加载顺序（process.env 优先于
   `.env.local`），子进程全程连接 orbit_test，从不触碰 orbit_dev。
3. 启动后不只看 stdout 的 "Ready" 字样（那只代表 HTTP 监听已打开，不代表应用
   运行时通过了自己的环境校验）：脚本轮询 `GET /api/v1/me` 直到收到 401（该端点
   在无 cookie 时的唯一预期响应）才打印 `E2E_SERVER_READY`；超时或子进程提前
   退出都判定启动失败并终止该子进程树。
4. `src/server/env.ts` 的「测试库不得与开发库同名」校验为此新增一个精确、窄范围
   的例外：仅当 `APP_ENV=test` 且 `DATABASE_URL` 与 `TEST_DATABASE_URL`
   **逐字节完全相同**时放行——这精确对应上一步子进程覆写后的形状，不会放行
   「两个连接串数据库名恰好相同但其余部分不同」这类更可能是误配置的场景；
   开发/生产库名黑名单（`NON_TEST_DB_PATTERN`）在该例外下仍无条件生效。
5. `E2E_BASE_URL` 外部服务复用已禁用：预检查脚本和 Playwright 配置均直接拒绝。
   E2E/UI 使用 runner 管理的独立服务，`reuseExistingServer: false`，不通过请求头
   指纹推断未知服务使用哪个数据库。
6. 所有 E2E spec 文件的数据库直连与清理统一经 `tests/e2e/support/db.ts`：
   `withTestDb()` 独立再校验一次「测试库与开发库不同名」（与
   `e2e-server.mjs` 的检查互为纵深防御），`cleanupTestEmails(emails)` 按精确
   邮箱集合、FK 安全顺序（ActivityLog→IdempotencyRecord→Invitation→Task→
   ProjectMember→Project→User→Verification）删除，对不存在的邮箱是安全空操作，
   不做任何范围扩大的清理，失败时抛出异常而不是吞掉。
7. `pnpm test:ui` 继承相同的隔离配置、夹具清理和 global teardown。
   默认先生产构建，再启动 3100 端口的独立测试服务；显式 `E2E_SERVER_MODE=dev`
   也只改变构建模式，不改变数据库隔离。两套测试结束后均核对开发库和测试库
   所有 public 表的内容指纹，残留、误删或其他内容变化均使命令失败。

历史维护脚本：`cleanup-migration.ts` 已停用，不能重放删除迁移历史或 DROP 操作。
`cleanup-invitation-tokens.ts` 默认仅输出候选数量；执行变更需同时传
`--apply --database=<精确数据库名>`。更新在事务内完成，失败返回非零状态且不输出
驱动错误原文。它识别旧参数化路径及当前真实项目路径，不输出令牌值。

## 3. 环境变量

| 名称 | 作用 / 校验 |
|---|---|
| APP_ENV | development/test/staging/production，显式枚举 |
| APP_URL | 完整同源地址，生产HTTPS |
| DATABASE_URL | 正确环境的连接串，客户端不可见 |
| TEST_DATABASE_URL | 独立测试库，测试拒绝生产/开发库名 |
| BETTER_AUTH_URL | 与APP_URL和回调配置一致 |
| BETTER_AUTH_SECRET | 通过安全随机生成；不提交；测试与生产不同 |
| AUTH_TRUSTED_ORIGINS | 精确来源列表，不使用通配符放开 |
| SMTP_HOST/PORT/USER/PASSWORD/SECURE | 认证邮件传输配置 |
| MAIL_FROM | 已验证生产发件身份，本地可用orbit.local |
| STORAGE_ENDPOINT/REGION/BUCKET | S3兼容地址与私有bucket |
| STORAGE_ACCESS_KEY_ID/SECRET_ACCESS_KEY | 仅限本桶操作的服务端凭证 |
| STORAGE_FORCE_PATH_STYLE | 本地MinIO需要时true，按生产供应商配置 |
| LOG_LEVEL | 脱敏日志级别，生产默认info |
| AI_ENABLED | V1默认false；false时不要求AI变量 |
| AI_PROVIDER/AI_MODEL/AI_API_KEY | M7才使用，凭证仅服务端 |
| AI_DAILY_REQUEST_LIMIT | M7用户每日运行次数限制，默认10 |

用Zod等在服务启动时校验必需项，错误只展示变量名和预期格式，不回显值。不要将秘密变量加NEXT_PUBLIC前缀。客户端只需要由服务端提供的非敏感公开配置。

生产认证要求邮箱验证和可靠重置流程；SMTP未配置时不能把验证永久关闭来标记发布成功。本地Mailpit不是生产邮件服务。

## 4. 生产部署基线

首版采用持续运行的Node容器，部署到用户选择的容器托管平台或服务器，配托管PostgreSQL、私有S3兼容存储和邮件服务。供应商最终选择涉及账户/费用，在需要配置时处理；规划不假设已经购买或授权访问任何平台。

构建：多阶段Dockerfile、锁定Node基础镜像主版本与可复现digest、安装冻结依赖、生成Prisma Client、Next standalone构建、最小运行层、非root用户。浏览器上传流经Node服务，入口限制约12MiB请求体并在应用层对实际文件限制10MiB。

数据库与web尽量同区域，使用可信TLS，设置有限连接池（起点每实例5连接，结合实际数据库上限调整）。应用水平扩展时会话/幂等/限流来自数据库，不能依赖单机内存保存关键状态。

## 5. 发布顺序

1. CI完成所有当前版本检查，生成标识明确的镜像。
2. staging配置与生产分离，使用合成数据，验证迁移与冒烟。
3. 备份当前数据库，记录恢复点；首次空库也记录迁移版本。
4. 运行一次 migrate deploy。迁移不能在每个容器启动时并发执行。
5. 部署应用，等待ready健康检查；验证登录、任务写入、评论、私有上传下载。
6. 检查错误率、数据库连接和存储权限；记录发布版本及结果。

采用向前兼容迁移：先加字段/表→兼容代码→回填→确认稳定后再移除旧结构。V1少数据也保持此习惯。应用回滚至兼容镜像；数据库不通过盲目down migration回滚。不可兼容变更必须有具体备份恢复方案。

## 6. 维护、备份与恢复

维护任务由部署平台的定时任务每日执行一次，处理过期幂等记录、限流桶、1小时以上失效上传和cleanupPending对象；本规划不创建真实定时任务。函数本身幂等、限批量、记录处理数量和错误，不输出敏感key。

数据库每日备份，初始保留7天；附件存储开启适用的版本/备份机制并配置成本可控的保留策略。项目文件引用和实际对象都要能恢复，不能只备份数据库。V1不自动清空回收站。

至少在隔离环境做一次数据库+样例附件恢复演练：验证成员关系、任务版本、评论、文件下载与活动。记录实际恢复耗时与可能的数据窗口。目标RPO≤24小时、RTO≤2小时，仅是初始目标，实测后填写结果。

## 7. 故障处理

- 数据库不可用：ready失败；业务503；不缓存“保存成功”。
- 对象存储不可用：上传/下载局部错误；已保存任务仍可用；补偿任务可重跑。
- 邮件失败：允许重发并限流，页面不泄露账户存在性；日志含脱敏错误码。
- 版本冲突高：检查前端轮询、local队列和project锁耗时，不直接移除version校验。
- 测试误连非测试库：脚本立即失败，不自动清库。
- 生产凭证缺失：保持对应发布任务待验收，提供变量名清单和已完成的本地证据。

## 8. 发布报告

报告位置 artifacts/release/：提交/镜像/迁移版本、CI链接、部署时间与环境、实际冒烟、性能测量、恢复演练、已知限制。不要填预期分数或虚构在线人数。

### M5 附件与迁移运维验收（2026-09-11）

`pnpm cleanup:attachments` 显式加载 .env.local/.env，通过 react-server 条件运行 server-only 业务模块；一次最多 100 条，打印 cleanedCount、failedCount、releasedBytes，不输出对象 key。错误返回非零退出码。UPLOADING 超过一小时释放预留；FAILED/DELETED 等待至少 3 分钟后物理删除，防止与取消中的 PUT 竞争。幂等重跑不会重复扣额度。真实定时调度仍属 M6，当前未配置。

当前 11 个迁移均可从空库部署；uploadId 是 UUID，Attachment 的 task 关系是复合外键。中断遗留迁移会话可能持有 advisory lock；先核验持锁连接是否空闲、无事务及其来源，再处理旧迁移等待者与持锁者，不关闭迁移锁机制、不删除迁移历史。Windows 的 EACCES 端口错误可通过设置已确认可绑定的 E2E_PORT 避开；本轮使用 43127。

### 全项目审查修复后的运行约定（2026-09-11）

上述 11 迁移为 M5 历史验收；本轮新增事件时间 timestamptz 转换和已删除评论缓存清理，共 13 个迁移。先核对旧 TIMESTAMP 的 UTC 语义，再执行增量部署；详情见 [本轮迁移与验收记录](reviews/REVIEW-FIXES-2026-09-11.md)。应用连接固定 UTC，以满足当前 adapter-pg 7.10.0 的时间解析约定，date-only 截止日不变。

认证与业务端点统一按 `TRUSTED_PROXY_COUNT` 选择转发链中的来源；默认 0 忽略客户端提供的转发头并使用共享桶。大于 0 仅适用于受控代理正确追加/清洗头且源站禁止直接访问的部署。

附件集合端点不经过 Next Proxy，避免 Proxy 在路由准入之前缓冲请求体；会话、Origin、资源授权、通用写桶与上传专用门禁仍在路由/服务端执行。上传 10 次/用户/分钟、最多 2 条在途请求为单进程限制，多副本共享准入仍须在 M6 按 PostgreSQL 方案完成。
