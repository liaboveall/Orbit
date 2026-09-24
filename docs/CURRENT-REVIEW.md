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

## 验证

| 命令 | 结果 |
| --- | --- |
| `node scripts/verify-remediation.mjs`（输出目录 artifacts/remediation-20260924） | **PASS**；运行前后源码指纹一致 |
| · 规划校验、14 项反例探针、进度同步、镜像策略 | 均为 0 |
| · lint、typecheck、typecheck:scripts | 均为 0 |
| · test:unit / test:contract | 0；297 / 172 passed |
| · test:integration（真实 PostgreSQL） | 0；380 passed，开发/测试库指纹不变 |
| · test:e2e --retries=0（生产构建） | 0；102 passed，指纹不变 |
| · 客户端包体测量、test:ui --retries=0 | 0；UI 13 passed，指纹不变 |
| · audit --prod --audit-level=high | 0 |
| `node --conditions=react-server --import tsx scripts/recovery-drill.ts` | 0；一次性数据库中验证过期会话/验证记录清理与备份恢复 |
| `pnpm audit --json` | 0；761 个依赖，0 个已知公告漏洞 |
| `node scripts/verify-migration-history.mjs` | **1**；开发库 2 条历史 checksum 不符（既有事项，未改写）；测试库正常，两库结构一致 |

在原实现上确认新回归失败：上传分类 2 个（超时用例需等待原 120 秒时限，未在原实现上运行）、看板筛选 3 个、认证邮件 3 个、浏览器 8 个用例均失败；恢复修复后全部通过。页面读取额度的新测试依赖新增的页面准入模块，原行为由首轮观察复现（API 超额后页面读取仍成功）；连接池饱和原行为由修复前探针复现（P2028 → 500 INTERNAL_ERROR）。修复过程只使用 orbit_test 与一次性数据库中的合成数据，逐次清理。

## 仍开放的 7 组事项

| ID | 当前事实 | 关闭条件 |
| --- | --- | --- |
| RELEASE-CI | 修复提交 CI 成功；正式交付版本/镜像未绑定 | 发布时核对实际交付 SHA 的完整 CI 与不可变镜像 |
| UPSTREAM | 认证依赖的密码派生值比较仍为普通字符串比较（已在 1.7.3/@better-auth/utils 0.4.2 源码确认） | 跟踪上游修复并升级回归；不自行替换密码哈希体系 |
| CAPACITY | 只有本机/CI 实验 | 目标小规格服务器的内存、连接池、限流写入与混合附件流量实测 |
| DEPLOYMENT | 用户暂缓服务器配置 | HTTPS 双账号、真实邮件/私有存储、告警、维护调度、异地恢复与 RPO/RTO |
| MIGRATION-HISTORY | 开发库两条旧 checksum 不符（本轮复查未变）；测试库正常且两库结构一致 | 找回原始迁移字节或形成有证据的调和方案；禁止直接覆盖 checksum |
| DATA-RECOVERY | 历史数据事件缺少原始记录/备份 | 找回独立恢复依据 |
| NATIVE-DEVICE | 自动浏览器通过 | 真实输入法、原生缩放及辅助技术走查 |

## 限制

- 认证邮件改为响应后投递：进程被强制终止（SIGKILL/OOM）时未发出的邮件可能丢失，用户可重新发送；优雅停机会等待进行中的投递。
- 页面读取额度在生产配置下以真实会话与数据库桶验证，未在正式部署上做 RSC 洪泛压测。
- 时序修复以本地停滞/拒收 SMTP 替身验证，真实 SES/SMTP 延迟需部署后复核。
- 本机为 Windows、Node 26；CI/Docker 使用 Node 24，已由修复提交的远端 CI 覆盖。
