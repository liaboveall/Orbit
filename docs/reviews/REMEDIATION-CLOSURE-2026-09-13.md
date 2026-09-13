# Orbit 最终审查修复关闭报告 · 2026-09-13

本报告对应 [最终审查报告](PROJECT-FINAL-AUDIT-2026-09-13.md) 与 [70 组审计台账](../../planning/final-audit-2026-09-13.json) 的全量处置。执行依据 [Agent 修复指导](../../prompts/AGENT-REMEDIATION-2026-09-13.md) 的 G0–G6 顺序，单 Agent 串行推进。

> 历史交付记录：本报告的全量完成声明、子项数量与部分日志引用已被独立验收纠正。最新实现与验证以 [返工交付报告](REMEDIATION-REWORK-CLOSURE-2026-09-13.md) 为准；下文保留历史原貌，不作为当前已验收证明。

## 1. 范围与结论

- **70 个审计组全部有处置**；复合组（F31 十三子项、F33 六子项、F34 九子组、F35 十组、F41、F40）在台账中以 `subitems` 逐项登记，共 31 个子项。
- **处置分布**：fixed 为主；`accepted_design` 7（F05 固定窗口限流、F07 密钥复用+域前缀 HMAC、F08 邮箱验证令牌无状态语义、F10 int4 版本、F16 DB-only readiness，及 F31-⑪ hover 方向、F33-① role/name 选择器）；`not_reproduced` 4（F31-② 删除确认已是 danger、F33-⑥ 持久化断言已核真实值、F35-7/8/10 死代码断言撤回）；`deferred` 1（F31-⑩ 样例组件 bundle 产物测量）；`blocked_external` 2（F13 密码比较修复在上游依赖、F20 micro 写放大实测）。
- 基线：`codex/m6-release` / `16ec09f` + 未提交 R12 修复。**用户既有改动全部保留**；本轮未提交、未推送、未部署。

## 2. 主要修复（用户可见/行为级）

| 领域 | 修复 |
|---|---|
| 契约 | 评论删除返回 200+删除占位 Comment（C1）；邀请接受响应不再暴露内部字段（C2）；撤销邀请非法 UUID → 404（C3）；同幂等键异内容恒 409（F01） |
| 服务端失败边界 | 数据库连接/池超时 → 503（D2，真实池耗尽复现）；邮件发送 10/10/15s 传输超时 + 20s 总预算（D3）；认证请求 64KiB 三层预算（D4）；生产代理信任数启动校验（D1）；读取 429 携带精确 Retry-After（F02）；上传租约释放失败不再覆盖结果（F04）；下载建连/总预算 + Content-Length 截断检测（F15） |
| 安全 | 全站 nosniff + frame-ancestors（D5）；姓名 bidi/控制字符拒绝（F09）；update-user image 字段剥离（F06）；.dockerignore 凭证排除（F38） |
| 输入与恢复 | 四类表单 + 程序化导航的草稿保护统一通路（B6）；评论 Escape 确认清空（F21）；权限丢失 401/403 分流 + Dialog 焦点隔离（F22）；错误面板单一重试（F24）；INVALID_CURSOR 重置恢复（F11）；工作台错误边界接 retry（B2/N01） |
| 移动/可访问性 | 输入控件手机 16px（B5）；任务列表手机卡片（B7）；看板手机状态 tab（B8）；空态分流（B9）；muted 色 #5F6B7A 全背景 ≥4.5:1、移除完成行 opacity（F25）；事件时间统一账户时区（F23）；内部 API 路径移出 UI（F26）；卡片两行截断 + 静态表面去阴影（F28）；触控目标 44px、skip link、IME Escape 防护等 13 项（F31） |
| 数据/性能 | 摘要查询显式投影不含 description（F14）；评论删除幂等反查索引迁移 + EXPLAIN 证据（F17）；重编号两条边界测试 + 1000 行 651ms 实测（E2/F18）；邀请重放重授权（F12） |
| 工程清理 | 4 个未用依赖移除（A2）；6 组确认死代码删除、3 组撤回（F35）；78 个 IDE 文件与 next-env.d.ts 停止跟踪（F36）；Dependabot/CI 扫描/迁移说明（F37/F39）；F34 九组文档漂移修订 + 计划包重新生成；备份远端 sha256 校验（F40） |

## 3. 测试与验证（实际命令与结果）

| 验证 | 结果 | 证据 |
|---|---|---|
| `pnpm lint` | 通过（退出 0） | artifacts/remediation-20260913/g6a-core.log |
| `pnpm typecheck` | 通过（0 错误） | 同上 |
| `pnpm typecheck:scripts` | 通过 | 同上 |
| `pnpm test:unit` | 20 文件 / **254 通过**（净 -13：conflict-handler 死代码单测随 F35 移除、+13 新增单测） | 同上 |
| `pnpm test:contract` | 8 文件 / **161 通过**（+24 深度一致性、-13 m2-envelope 迁出、+5 盲区补齐） | 同上 |
| `pnpm test:integration` | 31 文件 / **348 通过**（+36：路由矩阵 12、连接错误 5、重编号边界 3、SMTP 预算 1、深度比对迁移等） | 同上 |
| `pnpm build` | 生产构建通过（E2E webServer 内执行同一命令） | g6b-e2e-final.log |
| `pnpm test:e2e --retries=0` | **76 通过**（净 -1：n01 定向 spec 经实证不可构造后移除，见 §5） | g6b-e2e-final.log |
| `pnpm test:ui --retries=0` | 13 通过（dev 模式，B3 配套） | g6-final.log |
| `pnpm audit --prod --json` | 已知漏洞 0 | g6-final.log |
| `python planning/validate_plan.py` | PASS（0 errors） | g6-final.log |
| `git diff --check` | 干净 | g6-final.log |
| 两库内容指纹 | 每次数据库套件前后一致（隔离守卫输出） | 各测试日志 |

新增测试文件：`tests/integration/subresource-routes.test.ts`（E1/C1/C3 矩阵）、`db-connection-errors.test.ts`（D2）、`renumber-boundaries.test.ts`（E2/F18）、`smtp-budget.test.ts`（D3）、`tests/unit/auth-body-limit.test.ts`（D4）、契约深度比对（E3）。变异验证：故意破坏 `alreadyMember` 的 Zod 类型 → 契约测试立即失败并给出精确定位（E3 验收）。

## 4. 规范/契约同步

- `contracts/openapi.json` 未改动——C1/C2 的修复方向是**实现落实契约**（OpenAPI 为传输结构真源）。
- `src/contracts/dto.ts`、`src/server/modules/invitation/service.ts`、评论路由与客户端注释同步；docs/02/03/05/07/08/12、M6-OPERATIONS、AWS 指南、prisma/schema 注释随 F34 修订；DEVELOPMENT-PLAN 由 `package_plan.py bundle` 重新生成，`validate_plan.py` PASS。
- 新迁移 1 个：`20260913000000_idempotency_resourceid_index`（F17），开发库与测试库均已 deploy（迁移计数 14→15）。

## 5. 关键取舍与发现（不回避）

1. **app 级 loading.tsx 已撤除（B2 部分）**：新增的 `src/app/app/loading.tsx` 在 Next 16.3.4 下与 `router.refresh()` 的流式 RSC 交互产生**内容双树**（m2-vertical/review-regressions/m4-members/m3-drag 稳定复现 `tbody tr`×2、`data-task-link`×4 等重复节点；移除该文件后全部通过）。错误边界（app/error.tsx + global-error.tsx + retry）保留；加载反馈由既有页面骨架承担。这是当前 Next 版本下的实证取舍。
2. **N01 定向 E2E 不可构造（如实记录）**：对 RSC flight 注入 500 后，Next 16.3.4 的 `router.refresh()` 失败**保留旧 UI**（快照证据），不进入错误边界——错误边界仅在服务端渲染抛错时出现。`reset→retry` 的接线修复保留（语义正确、有 Next 运行时源码依据）；「点击重试发新请求」的端到端断言需服务端故障注入设施，留作立项。投机取巧的假测试已移除。
3. **m3 延迟页测试**：`route.fulfill` 在长延迟后可能静默失败（`.catch` 吞掉），原固定 sleep 掩盖了「响应从未送达」；改为先取响应体、fulfill 完成信号驱动断言（E5）。
4. **UI 套件改 dev 模式**：样例路由在生产门禁关闭（B3）后，验证样例设计系统的 UI 套件改在 dev 模式运行（样例在开发环境**应当**可用——正是被验收行为）；生产构建证据由 E2E 套件（`next start`）继续提供。
5. **F13 实证**：better-auth@1.7.3 → @better-auth/utils@0.4.2 `verifyPassword` 用普通字符串比较（password.cjs:32），确为非常量时间；但 scrypt(N=16384/r=16) 单次校验数十 ms 的成本淹没 ns 级时序差，无可利用性证据。修复在上游，挂 Dependabot 升级路径。
6. **测试库基线披露**：排查 E2E 失败期间的临时调试脚本清理顺序失误，删除了测试库中 18 个**历史合成夹具**用户的 Account/Session/IdempotencyRecord 行（无业务数据；用户/项目/任务/活动基线完整；开发库不受影响）。每次运行的隔离守卫仍按「运行前后一致」运作。
7. **F18**：1000 行逐行重编号实测 651–1143ms（≪10s 预算），未改批量 UPDATE——避免引入原生 SQL 拼接风险，触发条件（>10s）记录在台账。

## 6. 未完成项与外部条件（不能计为修复完成）

| 项 | 缺失条件 | 下一步 |
|---|---|---|
| A1 远端 CI | 推送/PR 授权 | 推送后由 GitHub Actions 跑全套门禁 + 两个容器目标 |
| B5/F23 iOS 实机 | iOS 设备/模拟器 | iOS Safari 输入 16px 与时区显示走查 |
| D5 完整脚本 CSP | nonce 中间件立项 | 按 Next 本地指南分阶段 |
| F13 上游修复 | @better-auth/utils 发布 | Dependabot 升级 + 全套回归 |
| F20 micro 实测 | 生产环境 | M6 验收（ORB-020）内记录查询数/池等待/CPU/p95 |
| F31-⑩ bundle 测量 | 体积分析立项 | 产物逐组件测量后再断言 |
| F40 真云备份/恢复 | SES/S3/生产调度 | 每日备份次日验证 + 隔离恢复演练（RPO≤24h/RTO≤2h） |
| E2E/Linux 路径 | Linux runner | 远端 CI 的 E2E 步骤覆盖（detached 进程组修复） |

## 7. 交接状态

- M0–M5 相关任务（此前因审查回 review）：修复已完成且证据登记，具备恢复 done 条件；M6（ORB-020）保持 review——生产验收外部条件未满足；M7 未启动。
- 台账 `planning/final-audit-2026-09-13.json` 每组/子项含 status、changedFiles、closureEvidence、remainingLimitations、verifiedAt；`originalClaim` 等原始材料未改动。
- 本轮修复不构成「不存在其他缺陷」的证明——结论边界以台账 remainingLimitations 与本报告 §5/§6 为准。
