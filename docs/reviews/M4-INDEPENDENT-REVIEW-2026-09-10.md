# M4 独立验收：未通过

审查日期：2026-09-10；工作区：D:\FullStack\Orbit。结论：**M4 应回到 review，暂不推进 M5**。邀请、成员、活动与设置的基础页面已接真实数据，但一次性邀请、安全边界及异常流程不满足既定规格。

本报告基于当前文件、真实 PostgreSQL、路由处理器集成探针和隔离浏览器账户。原 [Agent 交付报告](M4-VERIFICATION-2026-09-10.md) 保留作历史，不作为验收结果。仓库尚无可供比较的已提交基线，本轮按当前工作树审查；没有修改应用源代码、原有测试或数据库迁移，没有实施 M5。

## 实际检查结果

证据根目录：`artifacts/m4-independent-2026-09-10/`。

| 检查 | 本轮实测 | 证据 |
|---|---|---|
| pnpm check | 通过：lint、含测试代码的 typecheck、122 unit、136 contract | check.log |
| pnpm build | 通过 | build.log |
| pnpm test:integration | 225/225 通过，无跳过 | integration.log |
| pnpm test:e2e --retries=0 | **19 通过、1 失败** | e2e.log |
| 撤销邀请失败用例单独复跑，无重试 | 1/1 通过，确认存在套件内时序/定位问题 | revoke.log |
| pnpm test:ui --retries=0 | 13/13 通过 | ui.log |
| 独立规格探针 | **9/9 用例失败**，20 处软断言不满足；对应下列真实缺陷 | probes.log、probes.json |
| 独立浏览器观察 | 真实双账户接受邀请、匿名登录回跳、成员权限及移除后页面、390px 设置检查完成 | browser.json、browser.log、browser-output/ |
| 规划校验（交付原状态） | **失败**：ORB-013/014/015 的 completed 不是允许的任务状态 | planning.log |
| 数据库 | orbit_dev / orbit_test 隔离；两库各 6 个已完成迁移，无 checksum 漂移；各 7 条 CHECK，但缺 Invitation 状态约束 | database.json |

浏览器测试复用本轮启动的 development 服务，生产构建单独验证，未做生产部署或生产模式全套浏览器验收。独立浏览器用例是记录观察的探针，其进程通过不代表观察到的业务行为合格。全部测试仅创建并清理自己的数据。

## 必须修复的问题

### R01 · P1 · 明文邀请令牌进入幂等记录

位置：`src/server/modules/invitation/service.ts:171`；`src/server/modules/idempotency/service.ts:228`。

创建邀请把含 token 和 invitePath 的 responseData 原样交给 commitIdempotency，后者直接写 responseBody。独立查询确认 `IdempotencyRecord.responseBody` 包含原始 token。Invitation 表只存摘要不能抵消这一泄漏。

违反 docs/05 §5 的明确要求。首次响应与持久幂等数据必须分离；持久记录仅保存允许的元数据，重放重新授权并返回 token=null。修复时应制定已有明文记录的定向清理方式，不要清空整个数据库。回归应检查所有相关持久记录，而不只检查 Invitation.tokenHash。

### R02 · P1 · 令牌放入路径和登录查询串，规定的 fragment 链接不能使用

位置：`src/server/modules/invitation/service.ts:161`；`src/app/invite/[token]/page.tsx:31`；`src/app/invite/page.tsx:26`；`src/features/invitations/InviteAccept.tsx`。

真实浏览器确认：生成链接为 `/invite/<token>`，匿名访问时 token 进入 HTTP 路径，点击登录后又进入 returnTo 查询串。未设置邀请页 no-referrer。按规格访问 `/invite#token=...` 则显示“邀请链接无效”。本轮开发访问日志也会留下这些路径，交付前已做脱敏。

按 docs/01 §5 改为 fragment → 客户端内存/sessionStorage → POST body；认证回跳只携带 `/invite`，接收/失效/撤销后清理临时令牌。验证地址、请求、Referer、日志与持久数据均不包含原始 token，测试产物同样需要脱敏。

### R03 · P1 · 一次性邀请可被两人同时接受

位置：`src/server/modules/invitation/service.ts:248–339`，重点是 314 行无条件 update。

接受流程先读取状态，随后无条件更新并创建成员；没有项目行锁、邀请状态条件更新或等价串行保证。独立探针持邀请行锁，让两次请求都读到未使用，再释放锁：**响应为 [200,200]，新增 2 名成员**。tokenHash 唯一只限制邀请记录，不限制这两次消费。

按 docs/04 的 Project 锁顺序，把二次授权/归档/人数/邀请状态检查、消费、成员创建和活动放进同一事务。接受与撤销也必须遵循一致的锁顺序。验收必须断言恰好一个不同用户成功、只新增一人，而不是“成功数等于新增数”。

### R04 · P1 · 接受邀请绕过归档与成员配额

位置：`src/server/modules/invitation/service.ts:248–339`。

虽然查询了 archivedAt，后续未拒绝归档项目，也没有人数检查。实测归档项目接受返回 200 并消费令牌；已有 owner+19 成员的项目再次接受后达到 **21 人**。前端甚至提示归档后仍能接受。

归档应返回 PROJECT_ARCHIVED；20 人满额时返回配额错误，均不得消耗 token。检查必须在 R03 同一项目锁内完成。同时，创建邀请上限被写为 10（36 行），实测第 11 条返回 422；规格为 **20 条有效未使用邀请**，需统一并验证第 20/21 条边界。

### R05 · P1 · owner、已有成员和重试的状态语义错误

位置：`src/server/modules/invitation/service.ts:275–326`。

实测：owner 接受自己的邀请返回 alreadyMember=false，并插入一条 owner 的 ProjectMember 记录；已有普通成员接受另一未用邀请会消耗它；同一用户重复接受刚刚成功的令牌，第二次返回 409。

这分别违反“owner 不存 ProjectMember”“已有成员不消耗未用邀请”“同一接受用户重试返回成功”。应显式判断 owner 身份、现有关系和 acceptedById，保留已经被移除用户不得借旧令牌重新加入的访问边界。为响应丢失重试补真实回归。

### R06 · P2 · 普通成员可读取邀请管理信息

位置：`src/server/modules/invitation/service.ts:413–424`；`src/app/app/projects/[id]/invitations/page.tsx`。

listInvitations 只校验成员关系，未要求 OWNER。独立服务调用成功，普通成员浏览器也能打开邀请页并看到已使用等记录。docs/01 权限表明确仅 owner 可查看邀请。

修复服务端权限与页面处理；不能只隐藏创建/撤销按钮。覆盖 owner 成功、普通成员拒绝、非成员统一 404。

### R07 · P2 · Invitation 缺少已接受状态的数据库约束

位置：`prisma/migrations/20260910001345_add_invitation/migration.sql:2–15`。

docs/04 要求 acceptedAt 和 acceptedById 同空/同非空 CHECK。两库均未安装；独立探针成功写入 acceptedAt 非空、acceptedById=null 的非法状态。

新增迁移并处理现有不一致记录，不要改写已应用迁移。考虑 acceptedById 的 ON DELETE SET NULL 与该约束的兼容性，并分别验证合法及非法状态。

### R08 · P2 · 活动日志错误描述真实操作

位置：`src/server/modules/invitation/service.ts:152–157, 387–392`；`src/server/services/member.service.ts:162`。

创建邀请写 MEMBER_JOINED，撤销邀请写 MEMBER_LEFT；成员主动退出也统一写 MEMBER_REMOVED。独立查询和截图确认 owner 仅创建邀请就显示“加入了项目”。这些不是缺少翻译，而是写入事件本身错误。

docs/05 §9 明确邀请创建/撤销仅在邀请列表展示，不新增活动；真正接受写 MEMBER_JOINED，自退写 MEMBER_LEFT，owner 移除写 MEMBER_REMOVED。现有测试按错误实现断言活动，需要恢复为规格断言。

### R09 · P2 · 成员移除获得项目锁后没有重新授权

位置：`src/server/services/member.service.ts:118–162`。

访问与目标成员检查都在事务外，获得锁后直接清理、删除、写活动。独立探针让退出请求等待 Project 锁，在释放前移除其成员关系；该旧请求仍返回 204，并以已退出用户身份新写 1 条 MEMBER_REMOVED。

获得 Project 锁后在同一事务重新读取请求者权限、目标关系。两个并发移除/退出不能重复产生退出活动，已失权请求不能继续写入。

### R10 · P2 · 新增邀请入口遗漏限流

位置：`src/app/api/v1/invitations/accept/route.ts:42–55`；`src/app/api/v1/invitations/preview/route.ts`。

接受入口未接共享写限流。实测同一用户 write 桶已返回 429，接受仍返回 200。预览/接受也没有 docs/03 §8 的 20 次/IP/分钟专用限制；匿名预览直接查库。

复用当前单进程方案并按已有部署边界处理可信 IP，补共享配额、邀请专用配额和 Retry-After 断言。本项不要求提前实现 M6 的多实例部署。

### R11 · P2 · M4 页面缺少后台刷新与权限失效处理

位置：`src/features/activity/ActivityFeed.tsx:132–159`；M4 members/invitations/activity 页面。

新增页面没有接入 M3 的聚焦/30 秒刷新机制，ActivityFeed 还将首屏 props 复制进 state，后续刷新不能自动替换；错误分支只对 401 跳转，对 404 留在原页。

真实两账户流程中，owner 移除成员后，新活动 API 返回 404，但该成员活动页在 focus + 31 秒后仍展示旧内容并留在项目。按 docs/01 §6、§8 接入刷新、保留编辑草稿、处理失权清理与跳出项目；分页追加也需避免旧响应覆盖新首屏。

### R12 · P2 · 验收测试和交付状态不能支持“全部完成”

位置：`tests/integration/invitations.test.ts:551–565`；`tests/e2e/m4-invitations.spec.ts:222–224`；PROGRESS、backlog、旧 M4 报告。

并发测试允许 [200,200]，只断言“至少一次成功”和“成功数等于成员数”，恰好容许 R03。其他测试明确沿用错误路径及活动语义，原报告声称的关键边界因此没有被验证。

全量 E2E 撤销用例把通知 Toast 的 listitem 也算作邀请，出现预期 1、实际 2；单独复跑通过，属于定位/时序不稳，不能据此声称数据库重复邀请。应限定列表范围并保留业务断言，不应加 sleep 或靠 retries 隐藏失败。

交付的 completed 不符合 backlog 的合法状态，规划校验实测失败。PROGRESS 把 M5 / ORB-016 写成“批量操作与工作表视图”，既定任务实际是**子任务清单**。旧报告中的多个 API 路径、归档方法和活动过滤声明也与实现不符。审查同步状态时已改为 M4 review，并纠正下一阶段说明；其余原文保留作历史。

## 界面与可维护性观察

- 390px 设置页没有整页横向溢出，导航与归档确认可用；但页面把 PATCH 路径和 UUID 展示给用户，挤得“项目资料”标题换成两行。活动/邀请页也展示内部 API 地址，建议去掉这些开发信息。
- 设置表单目前只有名称和描述，未提供项目颜色编辑控件；若按“完整项目设置”交付，应补齐已有可编辑字段。
- 项目设置的并发错误仅刷新 props，表单字段保持原值，后续全字段保存可能覆盖别处更新；本轮未做该情形的独立写入复现，修复阶段应增加双窗口检查，不能把此观察当作已复现事实。
- 单 Node 内存限流、工作台样例和未部署属于已知阶段边界；本轮不将它们误判为新增 M4 缺陷。

## 修复与复验顺序

1. R01/R02：先处理令牌存储及传输，包含历史记录定向脱敏策略。
2. R03/R04/R05/R07：按项目锁重建邀请消费状态机、配额及约束，并补严格并发与重试测试。
3. R06/R08/R09/R10/R11：权限、活动、事务内重新授权、限流与客户端失权恢复。
4. R12：修正规格测试、消除不稳定定位、更新可信交接资料；再跑完整门禁与真实双账户闭环。

复现命令（项目根目录）：

```powershell
pnpm exec vitest run --config artifacts/m4-independent-2026-09-10/vitest.config.ts
# 本地服务和 Mailpit 可用后，独立浏览器观察：
pnpm exec playwright test --config artifacts/m4-independent-2026-09-10/playwright.config.ts --output artifacts/m4-independent-2026-09-10/browser-output
```

这些探针位于 artifacts，不修改正式测试套件；修复 Agent 应将相应规格回归整合进正式 tests。只有上述阻断问题关闭且完整复验通过后，才将 M4 标 done 并启动 M5。
