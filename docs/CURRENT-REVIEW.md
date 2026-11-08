# 当前代码审查与修复

审查日期：2026-09-22（首轮）与 2026-09-24（复核与修复）。基线提交：`09e9898a2dc06c467a5d70d1d01524f279129e59`；修复提交：`5730d69c064528272faa832c5f612f92cd867389`，[远端 CI 成功](https://github.com/liaboveall/Orbit/actions/runs/35953986961)。开放状态以 [open-items](../planning/open-items.json) 为准；命令结果及日志摘要以 [verification](../planning/verification.json) 为准。

## 结论

**两轮审查确认的 10 个应用问题已全部修复并回归验证；仍开放的是 7 组发布、历史与外部验收事项。** 首轮复现的 5 个 P2 复核属实；复核新增 3 个 P2、2 个 P3。每个问题都有新增回归测试并在修复后通过；其中草稿、后退、删除任务、看板筛选、认证邮件与上传分类的回归已在原实现上确认失败，页面读取额度与连接池饱和的原行为由修复前探针复现。低优先级的文档冲突、可访问性、附件文件名、认证记录保留、邀请令牌暂存与死代码一并处理。

未发现 P0/P1（越权读写、跨项目泄露、会话绕过）。修复后完整门禁 964 项通过（unit 297、contract 172、integration 380、e2e 102、ui 13），浏览器零重试，开发/测试库内容指纹前后一致。修复提交的[完整远端 CI](https://github.com/liaboveall/Orbit/actions/runs/35953986961)成功；PR 实际测试的合并提交与修复提交代码树一致（6d88e37）。

## 问题与修复

| ID | 级别 | 问题 | 修复 | 回归证据 |
| --- | --- | --- | --- | --- |
| DRAFT-LOGOUT | P2 | 确认退出后任务草稿仍以明文留在 localStorage | [draft-storage](../src/features/tasks/draft-storage.ts) 统一生命周期：成功退出删除该用户草稿（取消/失败保留）、外壳加载删除其他账号及过期草稿、退出项目或失去访问删除项目草稿、7 天过期 | E2E sign-out 用例；单元 draft-storage |
| DRAFT-HIDDEN | P2 | 已确认「放弃」的描述草稿会随后续只改标题的保存被悄悄提交 | 确认离开即删除本机草稿；恢复时草稿含有的全部字段以编辑态可见，只有一组保存/取消，并提示核对；新增「本机草稿」提示与删除入口 | E2E confirmed leave、reload 两个用例 |
| DRAFT-HISTORY | P2 | 无 Navigation API 的后退路径以首个编辑器挂载时的地址判断，漏掉之后打开的面板草稿 | [unsaved-changes](../src/features/tasks/unsaved-changes.tsx) 每次导航提交后记录当前历史条目，取消时恢复该条目；只改 hash 的链接不再误触离开确认 | E2E 禁用 Navigation API 的后退用例 |
| TASK-DELETED-404 | P2 | 打开中的任务在别处被删除后，下一次刷新把整个看板/列表变成 404，正在写的评论丢失；失效 `?task=` 链接整页 404 | 页面用 `findProjectTask` 取所选任务（缺失返回 null，项目不可见仍 404）；面板与独立页保留最后内容和草稿，只读提示「该任务已被删除」；失效链接显示说明 | E2E 看板、列表、独立页共 4 个用例 |
| BOARD-FILTER-CURSOR | P2 | 筛选集合在分页之间变化时，继续加载会漏卡片却显示已加载完 | [board](../src/server/modules/task/board.ts) 游标另绑定已返回前缀的数量与摘要，续页同快照复核，不一致返回 BOARD_CONFLICT；看板客户端对 INVALID_CURSOR 同样整体重载 | 集成：进入前缀、离开前缀、成员退出、无关修改 4 个用例 |
| PAGE-READ-LIMIT | P2 | 服务端页面直读不受每用户读取额度约束 | [page-session](../src/server/auth/page-session.ts)：页面经 `requirePageUser()` 与 API 共用读取桶，同一请求只计一次，预取不执行页面因而不计费（实测）；超额跳转 [/rate-limited](../src/app/rate-limited/page.tsx) | 集成 page-read-limit（生产配置、真实会话与桶）；单元 rate-limited-path |
| AUTH-VERIFY-FAILURE | P2 | SMTP 失败时匿名重发验证邮件对未验证账号返回 500 | [email-dispatch](../src/server/auth/email-dispatch.ts)：认证邮件经 Next `after()` 在响应之后有界投递，失败只写脱敏日志 | 集成：拒收 SMTP 下三种账号状态同为 200 |
| AUTH-EMAIL-TIMING | P2 | 认证邮件在请求内同步发送：找回密码对已注册邮箱多出整段 SMTP 耗时（实测 261—318 ms 对 5—13 ms），注册方向相反 | 同上，响应不再等待 SMTP | 集成：停滞 SMTP 下找回密码与注册立即返回且之后仍发起投递 |
| POOL-SATURATION-500 | P3 | 连接池饱和时事务在 maxWait 内无法开始（P2028）被映射为 500 | [connection-errors](../src/server/db/connection-errors.ts) 识别该固定形状为 503，其余 P2028 仍 500 | 集成：真实 1 连接池饱和 |
| UPLOAD-ERROR-MAPPING | P3 | 上传超时、客户端中断与数据库故障都被报成「上传表单不合法」 | [multipart](../src/server/modules/attachments/multipart.ts) 分类：超时/中断 → 503 STORAGE_UNAVAILABLE，依赖故障交给统一映射，只有表单错误为 400 | 集成 upload-error-mapping 4 个用例 |

低优先级事项：

- 文档冲突与漂移：成员退出清空负责人范围按数据模型统一到[产品规格](01-PRODUCT-SPEC.md)；[架构](03-ARCHITECTURE.md)删除 TanStack Query 依赖的过时说法，草稿说明改为实际的本机持久化规则；另在[决策记录](11-DECISIONS-AND-RISKS.md)补 ADR-024—027。
- 可访问性：独立详情页任务标题为 h1、面板中为 h2；描述中的 Markdown 标题从 h3 起。
- 附件文件名拒绝 bidi 嵌入/覆盖/隔离字符与 C1 控制字符，与姓名共用 [unsafe-characters](../src/server/modules/unsafe-characters.ts)。
- 维护任务分批删除已过期的会话与验证记录，恢复演练在一次性数据库中验证；MoveRecord、邀请、回收站仍按既有保留决策不清理，删除未使用的 `getTaskMoveHistory`。
- 待接受邀请令牌在标签页内最多暂存 30 分钟。
- 页面布局与页面共享一次会话查询；各领域服务仍各自授权（刻意的纵深校验）。

复核更正：首轮报告称本机 MinIO 容器与 compose 锁定版本不一致；核对镜像摘要后确认运行的正是锁定的 RELEASE.2025-09-07T16-13-09Z（同一 sha256），只是本地标签名不同，无需处理。

## 2026-10-19 全量深度审查与全面优化

在 `0928f35110d4db5589a63286f76e70a35b240494` 基线上对服务端运行时、RSC 路由、API 边界、领域服务、前端交互/移动端/可访问性及依赖安全进行了全栈深入排查与修复：

- **本地 IPv4 优先解析**：[env](../src/server/env.ts) 启用 `setDefaultResultOrder("ipv4first")`，消除 Windows 下 `localhost` 先尝试 IPv6 `[::1]` 再回退 `127.0.0.1`（Docker 仅绑定 IPv4）带来的约 338 ms 建连延迟。
- **RSC 页面与权限/游标容错**：
  - [邀请预览页](../src/app/invite/page.tsx) 读取当前登录会话并通过 [user-timezone](../src/lib/user-timezone.tsx) 注入用户时区与 `isLoggedIn`，使已登录用户按个人时区查看邀请过期时间且在暂态预览失败时不误判为未登录。
  - [登录页](../src/app/auth/login/page.tsx) 与 [注册页](../src/app/auth/register/page.tsx) 对已登录用户重定向时保留经 `sanitizeReturnTo` 校验的 `returnTo` 目标。
  - [项目邀请页](../src/app/app/projects/[id]/invitations/page.tsx) 先校验项目成员身份与 `project.role === "OWNER"`，非 owner 成员直接渲染只读权限提示而非抛出未捕获 403 触发错误边界。
  - [项目任务列表页](../src/app/app/projects/[id]/tasks/page.tsx) 与 [今日工作台](../src/app/app/today/page.tsx) 捕获游标/筛选签名 `VALIDATION_ERROR` 并渲染条件失效重置提示；[独立任务详情页](../src/app/app/projects/[id]/tasks/[taskId]/page.tsx) 显式声明 `dynamic = "force-dynamic"`。
- **API 路由与领域服务一致性**：
  - 移除 [评论路由](../src/app/api/v1/tasks/[taskId]/comments/route.ts) 与 [子任务路由](../src/app/api/v1/tasks/[taskId]/subtasks/route.ts) `GET` 处理器上多余的 `verifyRequestOrigin` 检查。
  - [JSON 读取器](../src/server/http/json.ts) 在 `finally` 中释放流 `reader` 锁，并在超限 `cancel()` 时吞掉源流异常。
  - 统一大小写无关 UUID 归一化：[邀请服务](../src/server/modules/invitation/service.ts) `createInvitation`、`previewInvitation` 空姓名兜底、[附件服务](../src/server/modules/attachments/service.ts) `uploadAttachment` 对象键构造，以及 [任务读取](../src/server/modules/task/read.ts)、[活动流](../src/server/modules/activity/reader.ts)、[工作台](../src/server/modules/workbench/service.ts)、[评论服务](../src/server/modules/comments/service.ts) 的游标筛选指纹；[成员列表](../src/server/modules/project/read.ts) 补充 `[{ joinedAt: "asc" }, { id: "asc" }]` 稳定排序并与 [member.service](../src/server/services/member.service.ts) 去重。
- **前端体验、移动端 16px 输入规范与可访问性**：
  - [时区选择器](../src/features/settings/timezone-picker.tsx)、[任务编辑器](../src/features/tasks/real/task-editor.tsx)、[今日工作台](../src/app/app/today/page.tsx)、[子任务项](../src/features/tasks/subtasks/subtask-item.tsx)、[子任务列表](../src/features/tasks/subtasks/subtask-list.tsx)、[评论项](../src/features/tasks/comments/comment-item.tsx) 移动端输入字号统一为 `text-body md:text-label`（16px 防 iOS 自动缩放）。
  - 子任务新建/编辑与评论编辑按 `Escape` 放弃非空修改草稿前弹出确认，与新建评论保持一致。
  - [任务编辑器](../src/features/tasks/real/task-editor.tsx) `reloadVersion`/`remove` 及 [真实看板](../src/features/board/real-board.tsx) `load`/`move` 补齐 401 登录跳转与 404 状态同步；[任务面板](../src/features/tasks/real/task-panel.tsx) 关闭焦点恢复兼容桌面与移动端可见触发器；[恢复按钮](../src/features/tasks/real/task-restore-button.tsx) 在非网络业务错误后轮换幂等键；[密码强度计算](../src/features/auth/validation.ts) 拒绝超 128 字符显示「很强」；[头像首字](../src/components/ui/avatar.tsx) 按 Unicode 码点切分；[项目设置](../src/features/projects/project-settings-form.tsx) 重置按钮同步清理冲突横幅状态。
- **依赖安全升级**：`next` 与 `eslint-config-next` 升至 `16.3.8`，`nodemailer` 升至 `10.0.16`，并通过 `pnpm.overrides` 锁定 `sharp@0.35.5`、`source-map-js@1.2.2`、`fast-uri@3.1.8`、`brace-expansion@1.1.21`/`5.0.12`，修复全部新披露的依赖安全公告。

## 验证

| 命令 | 结果 |
| --- | --- |
| `node scripts/verify-remediation.mjs`（输出目录 artifacts/rework-2026-10-19T10-22-33-368Z） | **PASS**；运行前后源码指纹一致（`680f0b72...`） |
| · 规划校验、14 项反例探针、进度同步、镜像策略 | 均为 0 |
| · lint、typecheck、typecheck:scripts | 均为 0 |
| · test:unit / test:contract | 0；304 / 172 passed |
| · test:integration（真实 PostgreSQL） | 0；380 passed，开发/测试库指纹不变 |
| · test:e2e --retries=0（生产构建） | 0；102 passed，指纹不变 |
| · 客户端包体测量、test:ui --retries=0 | 0；UI 13 passed，指纹不变 |
| · audit --prod --audit-level=high --json | 0；436 个生产依赖 0 漏洞 |
| 历史基线门禁（artifacts/remediation-20260924） | **PASS**；964 passed（unit 297 / contract 172 / integration 380 / e2e 102 / ui 13） |
| `node --conditions=react-server --import tsx scripts/recovery-drill.ts` | 0；一次性数据库中验证过期会话/验证记录清理与备份恢复 |
| `node scripts/verify-migration-history.mjs` | **1**；开发库 2 条历史 checksum 不符（既有事项，未改写）；测试库正常，两库结构一致 |

在原实现上确认新回归失败：上传分类 2 个（超时用例需等待原 120 秒时限，未在原实现上运行）、看板筛选 3 个、认证邮件 3 个、浏览器 8 个用例均失败；恢复修复后全部通过。页面读取额度的新测试依赖新增的页面准入模块，原行为由首轮观察复现（API 超额后页面读取仍成功）；连接池饱和原行为由修复前探针复现（P2028 → 500 INTERNAL_ERROR）。修复过程只使用 orbit_test 与一次性数据库中的合成数据，逐次清理。

## 2026-11-08 安全升级与重新上线

- **依赖漏洞**：`pnpm audit --prod` 从 2026-10-19 的 0 个增至 23 个（3 个严重、4 个高危），含 Next 图片优化接口的未登录远程执行。`next`/`eslint-config-next` 升至 16.4.5，`better-auth` 1.7.18，`zod` 4.6.7，`nodemailer` 10.4.0，`vitest` 5.1.0，并以 `pnpm.overrides` 锁定 `vite` 8.3.6、`fast-uri` 3.1.9，审计清零。
- **共用服务器**：[Nginx 路由 map](../infra/nginx-http.conf) 改用非捕获组，避免在未确认带上游修复的 Nginx 1.28.3 上引入 CVE-2026-42533 的触发条件；[单机编排](../infra/compose.micro.yml) 支持按主机设内存上限。
- **基础镜像**：`9618903` 的 CI 在镜像风险策略拦下基础镜像中 apt、libapt-pkg、perl-base 的 9 个可修复高危/严重项，其余检查全部通过；[Dockerfile](../Dockerfile) 改用已带修复的 Node 24 bookworm-slim 多架构 digest（`72ff749`）。
- **上线**：从 2026-10-12 的最终备份恢复（16 条迁移、1 个账号、1 个项目，无任务与附件），服务器原生构建提交 `72ff749` 的 ARM64 镜像，第一阶段在 https://149-118-55-232.sslip.io 运行。

| 命令 | 结果 |
| --- | --- |
| `node scripts/verify-remediation.mjs`（输出目录 artifacts/rework-2026-11-08T15-00-48-918Z） | **PASS**；干净提交，运行前后源码指纹一致（`c68c74ca...`） |
| · test:unit / test:contract / test:integration / test:e2e / test:ui | 0；304 / 172 / 380 / 102 / 13 passed |
| · audit --prod --audit-level=high | 0；0 漏洞 |
| `node scripts/verify-compose.mjs`、`node scripts/verify-nginx.mjs` | 均为 0 |
| `node scripts/verify-migration-history.mjs` | 0；开发库与测试库无缺失、无不符 |
| 本机 Trivy 0.69.3 扫描 `72ff749` 的 runner 与 operations 镜像，`scripts/check-image-scan.mjs` | 0；无可修复的高危/严重项，两个镜像各有 35 个上游未修复项按策略保留 |
| [`9618903` 的远端 CI](https://github.com/liaboveall/Orbit/actions/runs/42492606600) | 只有镜像风险策略失败，修复见上 |
| [PR #26](https://github.com/liaboveall/Orbit/pull/26) 最新提交的远端 CI（代码与 `72ff749` 相同，只多本记录） | 记录时尚未完成，结果以 PR 的检查为准 |

本地门禁之后只改了基础镜像 digest 和本记录，基础镜像由上述扫描与 CI 覆盖，未重跑本地门禁。同一天更早的一次门禁（`259939d`）14 项检查全部退出 0，但因 `next dev` 在运行中改写 `AGENTS.md` 被判 FAIL，未作为证据；提交该文件后重跑才得到上述结果。

## 仍开放的 7 组事项

| ID | 当前事实 | 关闭条件 |
| --- | --- | --- |
| RELEASE-CI | 2026-11-08 重新上线已绑定提交 `72ff749` 与 ARM64 镜像；正式 V1 版本待定 | 发布时核对实际交付 SHA 的完整 CI 与不可变镜像 |
| UPSTREAM | 认证依赖的密码派生值比较仍为普通字符串比较（已在 1.7.18/@better-auth/utils 0.5.1 源码复查） | 跟踪上游修复并升级回归；不自行替换密码哈希体系 |
| CAPACITY | 只有本机/CI 实验与线上空载内存读数 | 目标小规格服务器的内存、连接池、限流写入与混合附件流量实测 |
| DEPLOYMENT | 第一阶段已重新上线（无自有域名与邮件） | HTTPS 双账号、真实邮件/私有存储、告警、维护调度、异地恢复与 RPO/RTO |
| MIGRATION-HISTORY | 原不符的开发库卷已不在本机；新建开发库、测试库核对无不符，未覆盖校验和 | 找回原始迁移字节或形成有证据的调和方案；禁止直接覆盖 checksum |
| DATA-RECOVERY | 历史数据事件缺少原始记录/备份 | 找回独立恢复依据 |
| NATIVE-DEVICE | 自动浏览器通过 | 真实输入法、原生缩放及辅助技术走查 |

## 限制

- 认证邮件改为响应后投递：进程被强制终止（SIGKILL/OOM）时未发出的邮件可能丢失，用户可重新发送；优雅停机会等待进行中的投递。
- 页面读取额度在生产配置下以真实会话与数据库桶验证，未在正式部署上做 RSC 洪泛压测。
- 时序修复以本地停滞/拒收 SMTP 替身验证，真实 SES/SMTP 延迟需部署后复核。
- 本机为 Windows、Node 26；CI/Docker 使用 Node 24，已由修复提交的远端 CI 覆盖。
