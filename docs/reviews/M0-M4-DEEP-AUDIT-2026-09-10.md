# M0–M4 全面审查与 M5 准入判断

审查日期：2026-09-10；审查对象：当前工作目录，无 Git commit 基线。结论：**M4_REVIEW_REQUIRED，暂不开始 M5 实现。**

本轮是审查，不是修复交付。未修改应用源代码、既有正式测试、迁移或环境文件；新增独立复现探针、证据和交接文档。没有清空数据库、升级依赖或提交 Git。未使用并行 Agent。

## 1. 结论与已确认能力

项目不是只有规划或假 UI：M0 工程、M1 真实认证/邮件、M2 任务生命周期和 M3 看板已经有可运行实现。本轮原有门禁全部通过，但额外按产品规则设计的 **4 个真实数据库探针和 2 个真实浏览器探针全部失败**。因此上一轮“所有阻断已关闭、M5 可开始”的推论不成立。

优先修复邀请事务一致性、配额和项目设置丢数据，再处理活动刷新与归档入口。M5 将复用成员权限、项目锁、任务详情和活动，带着这些错误接入子任务/评论/附件会扩大问题面。无需重做脚手架或替换技术栈。

| 范围 | 本轮判断 | 主要依据与缺口 |
|---|---|---|
| M0 工程与契约 | 基线可运行，有交付治理缺口 | check/build 通过；无任何 commit；文档存在过期声明；依赖扫描有告警 |
| M1 认证与设置 | 已覆盖主流程通过；未发现新的阻断 | 真实 SMTP、会话和认证回归通过；不是对所有安全攻击面的无缺陷证明 |
| M2 项目/任务 | 数据主流程可用，有功能遗漏 | 真实事务、授权、版本/删除恢复测试通过；归档项目没有列表找回入口，描述未渲染 Markdown |
| M3 看板/编辑 | 现有主流程回归通过 | 1000 任务分页、真实拖拽、网络失败、409 草稿、键盘回归通过；不能据此代表所有跨页缓存场景已验完 |
| M4 邀请/成员/活动 | **不通过** | 四项邀请数据库复现，活动刷新失效、项目设置冲突导致描述丢失 |
| M5 | **保持 todo** | 下一项仍为 ORB-016 子任务清单，之后评论、附件、工作台；不是批量操作或工作表 |

## 2. 本轮检查与证据

全部证据位于 [artifacts/m0-m4-audit-20260910](../../artifacts/m0-m4-audit-20260910/)。

| 实际命令 | 结果 | 证据 |
|---|---|---|
| `pnpm check` | exit 0：lint/typecheck；122 unit + 136 contract | check.log |
| `pnpm build` | exit 0 | build.log |
| `pnpm test:integration` | exit 0：17 files / 232 passed，未跳过 | integration.log |
| `pnpm test:e2e --retries=0` | exit 0：20 passed | e2e.log |
| `pnpm test:ui --retries=0` | exit 0：13 passed | ui.log |
| `pnpm typecheck:scripts` | exit 0 | 本轮终端输出 |
| `python planning/validate_plan.py` | PASS，交接更新后再执行 | planning.log |
| `pnpm exec vitest run --config artifacts/m0-m4-audit-20260910/vitest.audit.ts` | **exit 1：4 failed / 0 skipped，均到达业务断言** | probes.log |
| `pnpm exec playwright test --config artifacts/m0-m4-audit-20260910/playwright.audit.ts` | **exit 1：2 failed，均到达目标断言** | ui-probes.log、browser-results/ |
| `node artifacts/m0-m4-audit-20260910/db-audit.mjs` | exit 0 | database.log |
| `pnpm audit --prod --json` | exit 1：2 high、1 moderate、0 critical | dependency-audit.json |
| `git log -1 --oneline` | 无 commit，无法定位到已提交版本 | 本轮终端输出 |

既有业务测试计数合计 523（122+136+232+20+13），不含新增六个失败探针。绿色数量证明已有场景可运行，不证明遗漏场景正确。

数据库只读核查：orbit_dev、orbit_test 与磁盘同为 7 个迁移，checksum 全部匹配，无未完成/回滚记录；两库各有 8 条 CHECK，包含 `checked_accepted_at_and_by_id`。幂等记录顶层 token/invitePath 非空记录为 0。这只是该字段范围的检查，不是所有日志/备份的全局秘密扫描。

复现方法：数据库探针直接调用真实领域服务，唯一替换是把 Prisma 客户端绑定到本地 orbit_test，未 mock 事务/SQL。并发探针用独立连接持有真实 Project 行锁，并查询 pg_stat_activity 确认到达指定等待点后释放，避免依赖随机调度。探针按本轮 UUID 精确清理，核查 audit.invalid 用户残留为 0。浏览器探针使用真实注册/邮件/会话/API和正式构建，沿用现有 E2E 的 orbit_dev 配置，精确清理自身项目/用户。

探针编写过程中曾遇到环境 URL 相等校验和夹具缺 color，两项测试基础设施错误均已修正；上述最终失败均为业务断言，不能与前期脚本错误混算。

## 3. 已复现的阻断问题

### A01 · P1：成员上限漏算 owner

位置：`src/server/modules/invitation/service.ts:367`，计数 ProjectMember 后直接与 20 比较。owner 不在 ProjectMember 表，因此 19 行成员已经代表总人数 20。

复现：owner + 19 成员，另一个用户接受有效邀请。预期 LIMIT_EXCEEDED 且不消费 token；实际成功，总人数 **21**。对照 docs/01 §1、§4、§5。

修复要求：锁内统一使用 `1 + memberCount`；补充 19→20 成功、20→21 拒绝、拒绝不消费 token，以及满员但已成员/owner 不消耗邀请的边界。

### A02 · P1：不同邀请没有共同的项目锁，突破配额

位置：`src/server/modules/invitation/service.ts:269`，只锁 Invitation；项目读取和人数计数没有 Project FOR UPDATE。

复现：owner + 18 成员，三名不同用户持三条邀请同时接受。用 Project 锁使三次请求均在成员插入前完成计数，释放后 **三次全部成功，总人数 22**。同 token 的 FOR UPDATE 测试通过不能覆盖这个场景。

修复要求：按 docs/04 的 **Project → Invitation** 顺序序列化同项目邀请写。先只读定位 projectId，再锁项目、锁邀请、重读状态与人数；不要在现有 Invitation 锁之后追加 Project 锁，制造反向锁顺序。

### A03 · P1：接受邀请与归档竞争，归档后仍加入

位置：同服务 `:329` 的无锁项目读取。

复现：归档事务已持 Project 锁且写入 archivedAt、尚未提交；接受请求读到旧未归档状态后等待成员插入；归档提交后，接受继续成功。实际记录为 **archived=true 且 ACCEPTED**，未进行锁后归档复核。

这与仅测试“已经归档再调用 accept”不同。修复须与 A02 一并纳入统一项目锁，并验证归档先提交时拒绝且 token 未消费；接受先完成时归档可正常执行。

### A04 · P1：撤销等待接受完成后仍返回成功

位置：同服务 `:438` 先 findFirst 检查，`:455` 按 id 无条件 update。

复现使用真实 accept/revoke 服务：accept 锁邀请并等待成员插入，revoke 读到旧未消费记录后等待邀请更新；accept 完成，再让 revoke 继续。结果 **ACCEPTED 与 REVOKED 同时成功**，数据库 acceptedAt 和 revokedAt 同时非空。UI/API 的撤销成功不能保证邀请未被使用。

修复要求：撤销也遵循同一项目锁/邀请锁，并在锁内重读；若接受已完成应返回 INVITATION_USED。补充反方向“撤销先成功，接受必须失败”的竞争。现有 CHECK 只保证 acceptedAt/acceptedById 成对，不能代替业务状态机。

### A05 · P2：活动后台刷新请求成功，但新记录不显示

位置：`src/features/activity/ActivityFeed.tsx:135`，activities/cursor/hasMore 只用初始 props 初始化；新增 useAutoRefresh 并未同步这三份 state。页面也没有根据数据变更设置重建 key。

真实浏览器复现：打开只有 1 条记录的活动页，通过 API 创建任务；触发 focus 并等待 RSC 响应。预期 2 条，实际持续 **1 条**。原 E2E 只检查进入页面及加载更多，未检查停留页面后出现新活动。

修复要求：明确首屏权威数据与历史分页的合并/重置策略，去重并阻止旧分页响应污染新数据。只添加轮询 hook 不够。Next 官方说明 refresh 会保留未受影响的 useState，不能把 refresh 当成重新挂载组件。[官方 useRouter 文档](https://nextjs.org/docs/app/api-reference/functions/use-router)。已同时阅读本地 16.3.4 随包文档。

### A06 · P1：项目设置冲突后再次保存，覆盖未编辑字段

位置：`src/features/projects/project-settings-form.tsx:55`、`:85`、`:98`。表单保留旧 description，但 409 后 router.refresh 更新了 project.version；后续提交无条件包含 name 和 description。

真实浏览器复现：本窗口只修改名称；另一请求把描述改为“远端必须保留的描述”。第一次保存 409，按页面提示再次保存返回 200，远端描述被写成 **空字符串**。服务端 version 校验正常，错误在客户端把旧草稿与新 version 自动组合。

修复要求：维护编辑基准与 dirty fields，只提交用户实际修改字段；冲突时展示远端变化并显式决定如何合并，不能仅刷新版本号后提交旧整表。验收须包含两个窗口分别改名称和描述，以及同字段冲突。

## 4. 其他明确缺口与技术债

| ID / 优先级 | 问题、证据与影响 | 处理边界 |
|---|---|---|
| A07 / P2 | `src/app/api/v1/invitations/preview/route.ts:31` 和 `accept/route.ts:36` 没有任何限流调用；accept 也未接共享用户写桶。与 docs/03 §8 的 20/IP/分钟不符。匿名请求可持续访问数据库，接受可反复抢邀请锁。静态确认，未做流量压力测试。 | M4 修复；单机内存与多副本共享是另一问题，不能把“完全未限流”混成 M6 多副本优化 |
| A08 / P2 | `src/app/app/projects/page.tsx:40` 固定默认 archived=exclude，不读取 searchParams；ProjectListClient 无归档 tab。项目归档后离开页面，项目列表无法找回并进入恢复页，手动已知 URL 才可访问。与 docs/02 项目列表和 M4 完整设置 UI 不符。 | M4 补齐归档列表入口；新增“归档→离开→列表找回→恢复”的 E2E |
| A09 / P2 | `src/features/tasks/real/task-editor.tsx:460` 直接显示 description 字符串。输入标题/列表/代码块/链接不会按受限 Markdown 展示；纯文本逃逸相对安全，但并未实现 docs/01 §6 的格式能力。 | 作为 M2/M3 遗留修复，建议 M5 详情扩展前处理；补正反例与危险 URL 测试 |
| A10 / P2 | Playwright 默认使用应用普通 DATABASE_URL；M3/M4 测试甚至硬性要求本地 orbit_dev。与 docs/08 独立 orbit_test 约定冲突。数据库快照中 dev 有161用户、test有38项目；未将所有现存记录判为测试垃圾。 | 在引入附件测试前统一独立测试服务、数据库、对象前缀与 runId 清理；禁止直接清空 dev |
| A11 / P2 | 交接前 README 与 PROGRESS 准入结论矛盾；backlog 声称 activity 支持 action/entityType 过滤，但 reader 和 OpenAPI 只有 cursor/limit；providers 实际采用 RSC+API，docs/03 仍指定 TanStack Query 缓存。 | 本轮修正最新准入状态并保留历史证据；其余差异需单独统一规范，不应为兑现错误证据无端添加功能 |
| A12 / P2 | 无 Git commit，M0–M4 全部是 untracked 工作树，无法建立可比较版本或可靠回滚点。 | M5 动工前建立经审查的基线；本轮不擅自提交日志/凭证或全量 git add |
| A13 / P3 | InviteAccept 归档提示说“接受后无法编辑”，但服务端禁止接受；“此邀请链接仅对你有效”不符合无指定邮箱的一次性 bearer 邀请。失效/撤销分支也没有清除 sessionStorage token，只有成功接受清除。 | 修正文案及终态清理，不能把它描述为已确认的服务端 token 泄漏 |

另：`src/server/http/errors.ts` 将任意 Error.message 原样写入 console.error，这不是通用脱敏机制，Prisma 错误可能含调用上下文。需要 M6 统一结构化错误日志；本轮未证明真实用户正文已经泄漏。读取 300/用户/分钟、持久共享限流、健康检查、CI/部署、备份恢复仍属于尚未完成的发布工作，不能使用“生产就绪”描述当前版本。

## 5. 依赖扫描结果的实际含义

`pnpm audit --prod --json` 有三个 advisory：

- deepmerge-ts 7.1.5，高危，来自 Prisma 配置链；公告要求递归对象图，普通 JSON 不直接构成该条件，修复版本 ≥8.0.0。[维护者公告](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx)
- mysql2 3.15.3，高危认证降级、moderate 压缩协议解压问题，来自 Prisma 依赖链；分别修复于 ≥3.22.0、≥3.23.1。[认证公告](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-3f6p-5ww8-9rcr)、[解压公告](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-rgwj-5xj2-c3m3)

Orbit 当前运行路径是 PostgreSQL adapter，不是 mysql2 连接，未找到上述触发条件的业务调用。**扫描失败是需要处置的依赖风险，不等于已经证明本项目可远程利用。** 应通过兼容的 Prisma 补丁/依赖处置及回归关闭，不能盲目 overrides 跨主版本升级。它们不取代 A01–A06 的实际阻断证据，也不能直接拿数量宣称当前系统被攻破。

## 6. 权限、事务、测试覆盖评价

已有的正确基础：ownerId 为 owner 权威来源；非成员统一 NOT_FOUND；owner-only 操作独立检查；任务写在 Project 锁后复核成员/归档/版本；移除清空全部分配并增加 version；看板用一致快照；幂等任务重放复查可见性；Origin、body 大小、schema、no-store 已有公共实现。现有 permission/project/task/members/invitations 集成与 E2E 本轮重跑通过。

不足不在于“没有测试”，而在于测试选择：

1. 同 token 竞争覆盖了邀请行，却没覆盖多个 token 共享的人数和项目状态。
2. 状态测试往往先完成归档/撤销再调用下一操作，未构造正在执行的并发状态。
3. 现有活动测试导航到页面后验证，不证明同一页面能跟随新 props 更新。
4. 项目设置只验证归档/恢复按钮，没覆盖独立字段编辑冲突。
5. 契约测试包含 36 个规划 operation 的字段/枚举/路径静态一致性，并不表示 36 个端点全已实现或全角色全状态矩阵覆盖；M5 端点仍是规划。
6. 本轮检查已有路由的认证/Origin/限流入口及主要领域服务，也运行正式权限套件；没有把每个端点 × 每种身份 × 每个状态 × 每种并发排列全部穷举，不将未测试排列写为通过。

PostgreSQL 行锁仅协调同一行的相关写/锁操作，普通 SELECT 仍可读旧提交状态；不同 Invitation 行也不会替项目人数计数提供串行化。这与上述真实探针吻合。[PostgreSQL 17 锁文档](https://www.postgresql.org/docs/17/explicit-locking.html)

## 7. M5 前的明确门禁

1. 修复 A01–A04，统一 create/accept/revoke 与项目写的锁顺序；保留同 token 恰好一人成功，新增不同 token 配额、归档/撤销竞争和同用户重复加入。
2. 修复 A06 的冲突合并，再修 A05 的刷新/分页同步；将两条浏览器探针提升为正式回归，防止再次用“加了 refresh”替代行为验证。
3. 补齐 A07 邀请限流和 A08 归档找回入口；安排 A09 的受限 Markdown，不把缺失能力标记完成。
4. 统一测试环境和交接真源，建立审查后的 Git 基线。M5 附件测试必须使用独立存储前缀并验证精确清理，不扩大 dev 数据污染。
5. 同一工作树重跑 check/build/integration/e2e/ui、规划校验和本轮探针，所有目标断言真正执行并通过；补充类型检查审查探针后再纳入正式测试。

满足门禁后按 **ORB-016 → ORB-017 → ORB-018 → ORB-019** 推进。M5 需特别守住：子资源自己 version、父 updatedAt 与 version 分离；评论删除清正文；附件上传前后两次授权、Project→Task→子资源锁顺序、配额预留/补偿；工作台按当前成员关系与真实 assignee 查询。正式性能、生产部署和备份恢复仍在 M6，不是现在额外要求提前完成所有发布工作。

本轮状态更新将 ORB-013/ORB-015 和 M4 退回 review；ORB-014 保留已有通过证据，M0–M3 保留历史里程碑状态并在本报告注明遗留问题。M5 全部保持 todo。没有执行 M5 开发。
