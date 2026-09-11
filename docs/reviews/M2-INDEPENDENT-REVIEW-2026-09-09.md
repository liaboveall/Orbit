# M2 独立复核（2026-09-09，Codex）

## 修复复验：M2 已通过（2026-09-09，Codex）

**R1—R4 均已修复并通过回归。** M2 / ORB-007 / ORB-008 / ORB-009 为 done，applicationStatus = M2_PROJECT_TASK_COMPLETE。本轮仅完成 M2，未推进 M3。以下“当前结论”及发现章节保留为修复前审计历史。

### 最终行为

- R1：任务行共享 `useTaskMutation`，React Transition 覆盖 API 请求和刷新提交；状态与删除入口在新 version 到达前共同禁用。恢复按钮也采用相同机制，避免成功后刷新窗口中的重复操作。
- R2：恢复先复核当前成员和 owner/创建者权限，再判定幂等记录。已完成且目标仍可读的恢复请求返回原结果，新恢复操作仍要求处于回收站；被移除成员或再次删除后的旧响应均不可重放。前端传输失败保留原 key/body。
- R3：创建/恢复共用 `readTaskReplay`，在项目锁内校验缓存 resourceId、项目归属、当前未删除状态和 DTO；唯一键冲突的后备路径也在新事务内重新执行授权和可见性检查。
- R4：`dateInTimezone` 统一用户日历日期；API 读取账户当前时区，任务页使用真实会话时区。逾期游标绑定当前本地日期，跨日/改时区后过期筛选游标不会静默混用。date-only 存储方式保持原样。

### 持久回归

| 文件 | 新增/增强覆盖 |
|---|---|
| tests/unit/calendar.test.ts | 7 个亚洲/美洲/跨日/夏令时日历日期用例 |
| tests/integration/task.test.ts | 并发与串行恢复重试仅一条活动、一次 version/boardVersion；新无效恢复、不同 body、再次删除、移除成员；软删除创建缓存不可读且不复活；修改时区后 overdue API 立即生效且排除 DONE |
| tests/e2e/m2-no-reload.spec.ts | 延迟 RSC 刷新时状态/删除入口禁用，刷新后第二次 PATCH 200；真实恢复已提交后中断响应，再次点击复用相同 key/body 并成功；恢复刷新期间禁用按钮；账户时区日期标记和 API 一致 |

### 实际检查

| 命令 | 结果 |
|---|---|
| pnpm check | exit 0；lint/typecheck、96 unit、136 contract |
| pnpm test:integration | 11 文件、152/152 通过 |
| E2E_BASE_URL=http://localhost:3000 pnpm test:e2e | 8/8 通过，零跳过；含 M1 回归 |
| E2E_BASE_URL=http://localhost:3000 pnpm test:ui --output artifacts/m2-fix-ui-results | 13/13 通过 |
| pnpm build | exit 0，生产构建通过 |

浏览器使用本地开发服务和真实 Mailpit；生产模式本轮只验证构建。UI 首次与 E2E 同时运行时共享 test-results，发生 trace 文件 ENOENT（12 通过、1 个报告收尾失败），随后改用独立输出目录重跑 13/13；未删测试或忽略断言。针对性 E2E 的首次测试工具清理也曾提前取消仍在处理的路由拦截，已修正为等待拦截完成后释放；最终完整套件通过。

证据日志：`artifacts/m2-fix-{check,integration,e2e,ui,build}.log`；截图 `artifacts/m2-fix-delayed-refresh.png` 与 `artifacts/m2-fix-user-timezone.png` 已查看。修复前 `artifacts/m2-independent-review/` 原始证据保留不覆盖。

实现依据：已安装 Next.js 的 `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`，以及 [React 19.2 useTransition 官方说明](https://react.dev/reference/react/useTransition)（await 后的更新再次进入 Transition）。没有增加依赖、改变数据库 schema、执行迁移或 seed、清空用户数据、提交 Git。本轮合成业务数据由测试按唯一账户清理；M1/UI 原有测试的合成认证账户遵循其既有清理策略。

---

## 修复前审计历史

## 当前结论

M2 主体及正常纵向流程已实现，但独立边界检查发现 4 项 P2，当前不应完全关闭验收。M2 调整为 review，applicationStatus 为 M2_REVIEW_CHANGES_REQUIRED；ORB-007 已验证基础范围保留 done，ORB-008/009 回到 review。本轮仅验证和记录，没有修复应用代码，也未推进 M3。

## 实际验证

环境：Windows、Node v26.8.1、pnpm 10.34.5、Next.js 16.3.4、Better Auth 1.7.3；本次启动 localhost:3000 开发服务，PostgreSQL localhost:5433，开发库 orbit_dev、集成测试库 orbit_test；真实邮件仅投递本地 Mailpit SMTP 25025/API 8025。

| 检查 | 本次结果 |
|---|---|
| pnpm check | exit 0；lint/typecheck、89 unit、136 contract |
| pnpm test:integration | 11 文件、148/148 通过 |
| E2E_BASE_URL=http://localhost:3000 pnpm test:e2e | 7/7 通过，零跳过；含 M1 回归、M2 持久化和不 reload 连续写 |
| 同一开发服务 pnpm test:ui | 13/13 通过 |
| pnpm build | exit 0，生产构建通过 |
| pnpm exec prisma migrate status | orbit_dev 4 个迁移 up to date |
| 直接读取迁移表并对比本地 SHA-256 | orbit_dev、orbit_test 各 4 个迁移 checksum 全部一致 |
| 直接读取 PostgreSQL 约束 | Project/Task 共 7 条 CHECK 存在 |
| 独立 HTTP / 浏览器边界检查 | 下列 R1—R4 均实际复现 |

没有重跑 seed 或执行迁移，避免改动现有业务样例。新增边界检查使用唯一合成账户，结束后精确删除该账户及其项目、任务、活动、幂等记录；没有清库。生产模式仅验证构建，未宣称生产部署或 CI 已通过。

证据：`artifacts/m2-independent-review/verify.ts` 为可重跑检查脚本；`observations.json` 为无凭证的观测记录；`delayed-refresh-conflict.png` 为真实浏览器截图。现有测试日志为 `artifacts/m2-review-{integration,e2e,ui,build}.log`。这些检查是复现证据，不是修复后的通过证明。

## R1 · P2：刷新响应较慢时，连续修改仍会误报版本冲突

位置：`src/features/tasks/real/task-status-select.tsx:69`（成功后 await router.refresh），同文件 93 行（finally 解除 pending）。

复现：任务 version=1、状态 TODO。用 Playwright 暂缓此次任务页的 RSC 刷新请求，第一次切换 IN_PROGRESS 的 PATCH 返回 200。刷新尚未完成，状态菜单已经重新可用，界面仍为“待办”。再选择 DONE，第二次请求仍提交 expectedVersion=1，得到 409 VERSION_CONFLICT；实际没有其他用户或并发编辑者。

本次记录：first=200、refreshHeld=true、staleLabel=待办、submittedVersion=1、next=409。浏览器截图还展示了错误提示“任务已被其他人更新”。

根因：已安装 Next 的 AppRouterInstance.refresh(): void（node_modules/next/dist/shared/lib/app-router-context.shared-runtime.d.ts:32），await 并不等待新 props 到达。因此此前去除 useState 镜像只解决了刷新完成后的同步，尚未覆盖刷新中的可操作窗口。现有 m2-no-reload 测试每次都等待新状态显示后才继续，恰好避开这一窗口。

修复验收：持有 pending 直到服务端新状态/version 真正生效，或将 PATCH 返回的权威 DTO 纳入一致的数据状态；核对删除/恢复等相同写后刷新路径。对刷新增加受控延迟，保证下一次操作被正确等待或使用最新 version，不再误报他人编辑。

## R2 · P2：恢复任务不满足相同请求重试语义

位置：`src/server/modules/task/restore.ts:114`，检查 deletedAt===null 的 404 在 beginIdempotency 之前；`src/features/tasks/real/task-restore-button.tsx:104`，网络异常后还会更换幂等键。

复现：删除任务后，用同一个 Idempotency-Key、相同 expectedVersion=2 恢复两次。第一次 200，第二次 404 NOT_FOUND；数据库只有一次恢复活动。第一次其实成功，但网络丢失响应后，用户无法从重试确认成功。

依据：docs/05 §5 明确恢复任务使用幂等键，同 key 同内容重放原业务结果。这里应区分“首次恢复一个未删除任务”和“已完成恢复操作的重试”，同时保持当前成员/owner或创建者权限检查。

修复验收：同一恢复请求在串行和并发重试下返回相同成功结果；仅增加一次 version/boardVersion/活动。网络异常保持原 key 和 body；已移除用户仍不可重放，新的无效恢复操作仍按规则拒绝。

## R3 · P2：软删除后，旧创建请求可取回任务正文

位置：`src/server/modules/task/create.ts:108`，replay 分支只复核项目可写/成员身份，直接返回缓存 TaskDTO，没有检查目标任务当前可读性。

复现：创建含合成 description 的任务，保存创建 key；软删除后正常 GET /tasks/{id} 为 404，但使用原 key 和原 body 重发创建请求为 200，响应仍含已删除任务的 description。

依据：docs/01 §6 规定软删除任务的详情 API 为 404，回收站只提供最小恢复信息；docs/04 幂等记录规则要求重放前确认目标资源仍可读。本次不是跨账户越权，但存在同一账户绕过软删除读取规则的另一入口。

修复验收：重放创建缓存之前，在事务内复核缓存 resourceId 对应任务的项目归属、成员关系及未删除状态；软删除后的重放不得返回完整正文，也不得重新创建任务。保留正常创建重试和被移除成员重试测试。

## R4 · P2：真实任务页及逾期筛选忽略用户时区

位置：`src/server/modules/task/read.ts:190` 与 `src/app/app/projects/[id]/tasks/page.tsx:67`。

复现时 UTC 日期为 2026-09-09，账户设置 Pacific/Honolulu，当地为 2026-09-08。新建 dueDate=2026-09-08 的未完成任务：对用户应为今天截止，但 GET tasks?overdue=true 将其列为逾期，任务页也显示红色逾期标记。截图顶栏与 /me 已确认账户时区正确。

根因：API 和页面都直接按 UTC 计算“今天”，混淆了 date-only 的存储方式与用户日历日期的业务判断。docs/01 日期规则要求按用户时区计算。虽然完整工作台属于 M5，已经交付的任务页/API 也应遵守此规则。

修复验收：服务器以账户 IANA 时区统一计算今天，再与 date-only 比较；覆盖亚洲/美洲跨日和夏令时。页面标记与 overdue API 必须一致，修改个人时区后生效。

## 已声明的范围限制

原交接已将真实任务详情/看板、TanStack Query、业务写限流推迟至 M3，子资源与工作台完整实现属于 M5；本次不把这些已声明的后续项另算作新增缺陷。当前任务列表仅提供状态等最小操作，不能将 M2 主体完成描述为 V1 已完成。

README 当时仍停留在 M1 状态，与 PROGRESS/backlog 不一致，本次已同步复核结论。

## 下一步

先修复 R1—R4 并添加持续回归，通过后再关闭 M2。旧 M2-VERIFICATION 报告保留为实现阶段历史证据，以本报告的独立复核结论为当前状态。
