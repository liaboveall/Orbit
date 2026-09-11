# M0–M4 独立审查与 M5 准入结论（2026-09-11）

## 结论

**当前不放行 M5。应先做一轮限定范围的收尾修复，无需推倒重写 M0–M4。**

项目具备真实认证、项目/任务持久化、看板排序、邀请和成员管理的业务基础。check、255 项真实数据库集成测试以及生产构建通过。不过，“所有 R1–R12 已关闭、门禁全绿、生产就绪”的最新交付声明与当前事实不符：正式 E2E 整体退出码为 1，正式 UI 有 3 项失败；独立探针还复现任务冲突恢复、邀请 API 缺失和邀请失败恢复问题。

本轮仅进行审查、测试和交接状态更新；未修改业务源码、既有测试或依赖，未实现 M5，未提交/推送。为使交接可读，修正了 backlog 的 JSON 分隔符错误。应用缺陷保留供后续修复。审查针对工作树，无可供定位的 commit SHA；过程中的源码指纹复核未发现漂移。

## 实测门禁

证据目录：`artifacts/m0-m4-audit-20260911/`。运行环境：Windows、Node 26.8.1、pnpm 10.34.5、已安装 Next 16.3.4、Prisma 7.10.0；真实本机 PostgreSQL 与 Mailpit，浏览器服务由正式隔离 runner 启动。

| 命令/检查 | 本轮结果 | 证据文件 |
|---|---|---|
| `pnpm check` | exit 0；lint、typecheck、259 unit、136 contract 通过 | check.log |
| `pnpm test:integration` | exit 0；19 文件，255 passed，无 skipped | integration.log |
| 生产构建 | 正式 E2E/UI 的 webServer 启动链实际执行 `pnpm build` 并成功启动 next start；未单独重复运行 build | e2e.log、ui.log |
| `pnpm typecheck:scripts` | exit 0 | scripts.log |
| `pnpm test:e2e --retries=0` | **exit 1**；38 passed，global teardown 测试库内容指纹不一致 | e2e.log |
| `pnpm test:ui --retries=0` | **exit 1**；10 passed / 3 failed，三个屏宽的 Escape 均失败 | ui.log、ui-results/ |
| 独立浏览器探针 | **4 failed**，全部到达业务断言；自身夹具清理后两库内容指纹不变 | behavior.log、behavior.spec.ts、browser-results/ |
| 独立安全探针 | **2 failed / 1 passed**；IP 校验/规范化失败，日志脱敏通过 | security.log、security.test.ts |
| `python planning/validate_plan.py` | 初始 FAIL：backlog 非法 JSON；本轮仅修正交接元数据后重验，结果见 plan-final.log | plan.log、plan-final.log |
| `pnpm audit --prod --json` | exit 1；2 high / 1 moderate，见后文可达性边界 | audit.json |
| 数据库迁移/约束只读检查 | 两库与磁盘均为 7 个迁移、checksum 一致，无 rollback；各 8 条 CHECK 均 validated | database-final.jsonl |
| 自有 API 路由与 OpenAPI 对照 | 当前阶段应有 22 个 operation，实际导出 21 个；另 14 个属于 M5，未提前要求实现 | routes.json、routes.mjs |

独立浏览器探针首次启动因审查配置的工作目录错误失败，修正为仓库根目录后才得到上述业务结果。首次记录保存在 behavior-setup-error.log，不计作应用缺陷。探针没有通过重试、改业务源码或弱化断言取得结果。

## 需要处理的发现

### A01 · P1 · 真实任务冲突恢复允许覆盖未展示的远端字段

- 位置：`src/features/tasks/real/task-editor.tsx:164`、`:176`、`:224`。
- 复现：任务 v1，本地将标题改为 Local audit draft；另一请求把标题改为 Remote unseen audit title、版本升至 v2。本地保存收到冲突，点击“载入最新版本并保留草稿”。函数把草稿 expectedVersion 更新为 2 并解除冲突，但标题输入继续取 `draft.title`，界面没有展示远端标题。再保存，真实 API 返回成功，数据库标题成为 Local audit draft、version=3。
- 证据：behavior.log 的 `remoteVisible:false`、`savedVersion:3`；browser-results 中 task-conflict-before-overwrite.png。截图已人工查看，提示要求核对，但没有可供核对的远端同字段值。
- 边界：后端 version 检查正常，GET 网络失败也不会推进版本；问题在客户端成功 GET 后的冲突决策体验。与已修好的**项目设置** R1 是不同组件。
- 修复验收：把远端快照与本地草稿同时展示，明确采用远端或保留本地；处理成功后才推进基准。远端二次变化仍应 409。至少覆盖标题、描述、独立详情及侧面板；保留现有网络失败保护。
- 测试缺口：现有 m3-workflows 冲突测试直接断言本地覆盖成功，没有检查远端值是否可见。

### A02 · P2 · M4 的邀请列表 GET API 缺失

- 位置：`src/app/api/v1/projects/[projectId]/invitations/route.ts:41`；`contracts/openapi.json:808`。
- 契约定义 `GET /projects/{projectId}/invitations`，owner 取得 Invitation 列表及 PageMeta；当前路由只有 POST 导出。真实已认证 owner 请求得到 **405**。
- 页面能显示邀请，是因为 RSC 直接调用 listInvitations 服务；不能据此认定 HTTP API 已交付。backlog 的 GET endpoint evidence 也不成立。
- 修复验收：实现 GET、cursor/limit、标准列表信封及 owner/member/非成员/无会话测试，不返回 token 或 tokenHash。保留归档态可读。
- 测试缺口：openapi-consistency 仅将手抄 operation 表与文档互比，未验证路由实际存在。对已交付阶段增加实际 route/HTTP 验证，M5 未交付接口仍明确排除。

### A03 · P2 · Escape 回归仍存在，且影响真实任务面板

- 位置：`src/features/tasks/task-detail.tsx:531`、`:554`；`src/features/tasks/real/task-panel.tsx:54`，以及 TaskEditor 内部的 closing Dialog。
- 正式 UI：390 / 768 / 1440px 打开草稿确认框，等待“保留编辑”获得焦点后按 Escape，确认框数量仍为 1，断言失败。
- 独立真实流程：真实任务侧面板编辑标题→关闭详情→确认框→Escape，确认框同样保留。该问题不再仅限 samples。
- 外层 Drawer 的退出逻辑和内层 Dialog 需要协调；仅在样例内层 preventDefault/setOpen(false) 的现有修改没有达到验收行为。本轮不把未经事件跟踪证明的单一传播路径当成唯一根因。
- 修复验收：Escape 只关闭最上层确认框，保留草稿和详情；焦点回到合理的触发元素。样例和真实组件均测试，不删断言、不加重试掩盖。

### A04 · P2 · IP 修复新增分支仍接受非法输入，等价地址不能归一

- 位置：`src/server/http/client-ip.ts:15–20`。
- `::ffff:1.2.3`、`::ffff:1..2.3`、`::ffff:01.2.3.4`、`::ffff:1.2.3.4.5` 均未进入兜底，而是返回冒号后的非法地址。正则里的字符集合不能约束四段 IPv4；Number('') 还会成为 0。
- `::ffff:c000:201` 与 `::ffff:192.0.2.1` 是同一地址，函数分别返回 `::ffff:c000:201` 和 `192.0.2.1`，导致不同限流桶。
- 安全边界：默认 TRUSTED_PROXY_COUNT=0 仍保守地忽略 XFF；本轮没有证明默认部署能被外部用户直接绕过。缺陷影响启用可信代理解析后的异常输入与规范化保证。
- 修复验收：先用可靠 IP 解析校验整个地址，再统一 mapped IPv6 与 IPv4 的桶键；保留空段、短链、scope ID 等现有拒绝规则，并验证代理拓扑。

### A05 · P2 · 邀请预览遇到临时故障会丢失恢复所需令牌

- 位置：`src/features/invitations/InviteAccept.tsx:140–146`。
- 片段 token 被转存到 sessionStorage 后从地址栏清除；但预览接口只要返回任何合法错误信封，就无条件 removeItem。注释只说清理终态错误，代码却包括 429/500/503。
- 独立复现：真实有效邀请→预览注入标准 503→解除故障→刷新，页面显示“该链接缺少邀请令牌”，无法按刷新恢复。网络异常 catch 分支保留 token 的逻辑对此无效，因为 503 是合法业务响应。
- 修复验收：仅过期、撤销、已用、不存在等确认终态才清除；429/5xx 保留临时令牌并提供重试。成功接受和终态清理仍须保持。

### A06 · P2 · 新增 R1 套件污染测试库，且测试名与断言不一致

- 位置：`tests/e2e/m4-project-settings-r1.spec.ts:41–54`、`:57–103`。
- beforeEach 注册并创建项目，未收集 email、没有 afterEach/afterAll 清理。本轮新增并遗留 **3 个账户、3 个项目**，正式 E2E 在 teardown 中以 exit 1 结束。
- 三个测试名分别声称验证 GET 500、conflictPending 和远端获取错误，实际仅填写正常表单、检查保存按钮 enabled/visible；没有发起冲突或注入 GET 失败。不能将这三条作为 R1 的证据。
- 不扩大认定：`m4-activity.spec.ts:422` 起另有真实网络/500/采用远端回归，本轮均通过，项目设置 R1 的实现确有证据。需要修的是新增套件与交付统计，不能说 R1 完全没测试。
- 正式隔离 runner 的防护有效：开发库未变，UI 和独立探针清理均通过指纹检查。问题是套件缺失清理，而非整个隔离方案失效。
- 修复验收：精确收集/清理测试邮箱，在失败路径也执行；将误标测试改成实际行为验证或移除重复的空洞证明。完整命令必须 exit 0，不能只摘录“38 passed”。

### A07 · P2 · 交接入口仍不可信，初始 backlog 无法解析

- 初始 `planning/backlog.json:109–110` 在 M5 和 M6 之间缺少 `},`，实际规划校验 FAIL（记录在 plan.log 和 backlog-before.json.txt）。
- README 写“暂不推进 M5”，PROGRESS 新条目写“100%/Ready for M5”，backlog 顶层 READY_FOR_M5，但 latestIndependentReview 仍是旧的不放行结论。
- 最新统计 `258 tests (229 unit + 136 contract)` 自身算术不成立；本轮实际是 259 unit、136 contract、255 integration、38 E2E 用例通过但总命令失败、10/13 UI。
- 本轮处理：仅修 JSON 语法，并把 README/PROGRESS/backlog 最新入口指向本报告；旧证据作为历史保留。M0、M3、M4 回到 review，M1/M2 保留 done，M5 暂阻塞；对应 ORB-002/012/013 回到 review。
- 后续必须用一次完整验收结果覆盖这些收尾问题，不能继续用新“最终报告”叠加互相冲突的声明。“可进入 M5”与“生产就绪”必须区分，后者还受 M6 验收约束。

## 已确认的基础与审查边界

| 范围 | 本轮确认的进展 | 本轮保留的边界 |
|---|---|---|
| M0 | 工程检查、类型边界、契约 schema 和正式构建可用；设计变量和组件基线存在 | 样例键盘回归失败；未进行全站视觉重验 |
| M1 | 真实认证/Mailpit、重置/会话、个人设置的既有集成和浏览器套件通过 | 未模拟外部生产 SMTP 故障；生产配置不在本轮 |
| M2 | 项目/任务 CRUD、配额、version、幂等、软删恢复与权限测试通过 | 不声称穷尽全部并发交错；没有重新做完整性能测量 |
| M3 | 真看板移动、分页、筛选、移动回滚和草稿恢复的既有 E2E 通过 | A01 冲突核对、A03 真实面板键盘交互须修 |
| M4 | 邀请人数含 owner、Project→Invitation 锁顺序；并发接受/撤销/归档回归、移除与分配清理、活动刷新、设置冲突恢复有实测覆盖 | A02/A05 接口与邀请恢复、A04 输入边界、A06 验收清理未闭环 |

静态核对了自有 22 个 M0–M4 operation，已实现的 21 个 handler 均有会话入口（匿名 preview 为契约例外），写路由接入 Origin 和业务限流；具体项目角色、归属及归档在业务层处理。task create/restore 重放有重新授权和资源可读性检查；写入配额在锁内处理；board 以 RepeatableRead 获取快照。既有 permission、cross-project、members、concurrency 测试本轮通过。以上不是“每个角色×每条端点×每个并发时序都做过动态测试”的声明。

日志原 R4 已确认改进：unexpected error 通过白名单字段输出，合成 password/token/连接串/name 探针未泄漏。没有将此推断为所有第三方日志或维护脚本都已经完成脱敏审计。

M5 的子任务、评论、附件、工作台尚未实现，属于下一阶段，不计为 M0–M4 缺陷。M6 的实际部署、CI、性能、备份恢复、生产共享限流也不应被强行提前作为 M5 的全部前置条件。

## 后续风险，不与当前应用阻塞项混淆

1. **依赖扫描仍有 2 high / 1 moderate。** 本轮路径均经 `@prisma/client > prisma` 进入 deepmerge-ts 7.1.5 / mysql2 3.15.3。应用使用 PostgreSQL adapter，未见业务调用 mysql2；deepmerge 的公告条件需要递归对象图，普通 JSON 本身不满足。没有证明这些警报在当前业务可利用，也不能宣称所有构建/部署场景绝对不可达。记录升级计划及可达性，按兼容版本测试，不盲目跨主版本 override。官方修复边界分别为 [deepmerge-ts 8.0.0](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx)、[mysql2 3.22.0 认证问题](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-3f6p-5ww8-9rcr)、[mysql2 3.23.1 解压问题](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-rgwj-5xj2-c3m3)。
2. **没有 Git 基线。** `git log` 无 commit，整个工程未跟踪。建议完成这轮收尾后建立可复现提交，再进入 M5；本轮未替用户提交。无 commit 本身不等于应用业务有缺陷。
3. **一次性维修脚本不应作为通用生产维护入口。** cleanup-migration.ts 直接改迁移记录、DROP TRIGGER/FUNCTION CASCADE，缺少目标环境闸门和整体事务；cleanup-invitation-tokens.ts 仍匹配旧的字面量 routeKey，处理失败后继续。仅做静态记录，未执行这些脚本；当前 7 个迁移均健康，不需要重跑历史维修。M6 前应隔离/归档脚本、补目标约束及失败语义。
4. **测试数据与证据管理。** 本轮开始前已存在 9 个 R1 项目残留，未扩大清理；artifacts 默认为 Git ignore，后续若要在干净 checkout 复跑独立回归，应将必要探针整理到正式 tests 并保存可追溯日志。

## 数据清理与复现

正式 E2E 未清理的本轮 3 个 R1 项目，通过前后快照差集选出并核对 owner、项目名和测试邮箱，在事务内精确回收；保留原有 9 个项目。见 cleanup-own-fixtures.mjs / cleanup.log。独立探针自身 afterEach 清理，global teardown 确认两库内容指纹未变；正式 UI 同样通过这一检查。没有清库、改迁移、修改用户开发数据。

复跑独立检查（仓库根目录，沿用本地独立测试环境）：

```powershell
pnpm exec vitest run --config artifacts/m0-m4-audit-20260911/vitest.config.ts
pnpm exec playwright test --config artifacts/m0-m4-audit-20260911/playwright.config.ts --retries=0
```

当前失败是这些探针的预期审查结果；修复后应在不弱化断言的情况下转绿。不要再次运行本轮精确清理脚本清理其他时间创建的数据。

## M5 放行顺序

1. 修复 A01 和 A03，先稳定 M5 将继续扩展的真实任务编辑器与弹层交互。
2. 补齐 A02 邀请 GET，修复 A05 暂时错误恢复与 A04 IP 解析。
3. 关闭 A06 清理/伪证据问题，保持 A07 单一最新交接入口。
4. 完整重跑 check、integration、生产构建、E2E、UI、scripts typecheck 和规划校验；E2E/UI 要求命令 exit 0、无重试掩盖、无本轮残留。独立失败探针转为正式回归。
5. 门禁通过后进入 **ORB-016 子任务清单 → ORB-017 评论讨论 → ORB-018 私有附件与补偿 → ORB-019 我的工作台与时区**。先规格与验收，再实现垂直流程；沿用现有项目锁、权限、version 和活动事务边界。附件需真实 MinIO 联调，不用样例按钮或公开目录代替。

建议本轮先稳定上述有限范围，再重新评估 M5 准入；不建议再安排一轮没有清晰退出标准的全项目重构。
