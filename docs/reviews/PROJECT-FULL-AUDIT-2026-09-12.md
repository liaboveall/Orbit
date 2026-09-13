# Orbit 全项目深入审查总报告（四轮合并）· 2026-09-12

> **审查对象**：分支 `codex/m6-release`，HEAD `16ec09f`，含 R12-01–R12-07 修复的未提交工作区（审查全程工作区保持零变动，45 条 git 状态条目与审查开始时一致）。
> **审查方式**：四轮独立审查——R1 五线全扫 + 覆盖率量化；R2 交叉复核 + 规范/安全/数据/工程一致性；R3 库集成/运行时/视觉/供应链深潜；R4 测试质量审计 + 全页面状态矩阵 + 全套动态实证。
> **工具证据**：所有动态命令由审查者在本地实际执行（见 §2），静态发现均带 `file:line` 定位。
> **总体结论**：四轮累计 **零 P1**（唯一历史 P1 R12-01 已于早期修复）；合并去重后 **25 项 P2 级问题、约 55 项 P3**，全部有精确定位；核心数据/权限/事务逻辑经受四次独立扫描**零新洞**；测试 806 项逐套件机械核对与文档声称完全吻合。新发现重心逐轮从业务逻辑移向规范符合性与打磨层，静态审查收益已明显递减。

---

## 0. 执行摘要

| 轮次 | 方法 | 新 P2 | 新 P3 | 勘误 |
|---|---|---|---|---|
| R1 | 认证/HTTP、业务模块、26 个路由逐文件、前端、测试/基建 五线并行 | 6 | ~15 | — |
| R1.5 | 测试覆盖率量化（临时安装 @vitest/coverage-v8） | — | 6 项覆盖缺口 | — |
| R2 | 五线交叉复核（独立再推导）+ 规范一致性/安全滥用面/数据边界/工程链路 | 6 | ~12 | 撤回 1、修正 2 |
| R3 | Better Auth 库源码级、24 处原始 SQL、S3 流/停机/连接池、对比度计算、文档剩余、仓库卫生 + 生产构建/冒烟/审计/秘密扫描 | 6 | ~20 | — |
| R4 | 测试套件质量审计（"审查测试本身"）、docs/02 全页面状态矩阵、全套动态实证 | 11 | ~10 | 修正 1 |

**最重要的 5 件事**（详见 §5 行动清单）：

1. **整批原子提交工作区**——存在"部分提交即损坏"结构（未跟踪的 `src/server/http/log.ts` 被已修改的 email.ts/options.ts 引用；`vitest.config.ts` 引用未跟踪的 `tests/setup/integration-isolation.ts`），且 `.gitattributes` 必须与 `infra/backup-database.sh` 同批提交；未提交的 R12 修复从未跑过远端 CI。
2. **生产化三件事**：连接池耗尽/PG 连接上限返回 500 而非 503；邮件发送失败被静默吞掉 + SMTP 无超时；`/api/auth/*` 无请求体大小上限。
3. **P2 交互批**：today 样例横幅、全局 error/loading 边界、iOS 16px 输入、草稿保护补全、样例路由生产可达、favicon/OG 缺失、移动端表格/看板违反 docs/02 §4。
4. **契约对齐 + 契约测试升级**：评论 DELETE 与 AcceptedInvitation 两处漂移；一致性测试只比字段名不比类型/必填/枚举/请求 DTO。
5. **清理批**：4 个未用生产依赖、约 80 个 IDE 生成文件入库、10 处死代码、文档漂移归一。

---

## 1. 勘误声明（交叉复核产物，保证报告可信度）

| 原发现 | 裁定 | 依据 |
|---|---|---|
| R1：「存在未文档化的 `GET /attachments/{attachmentId}`」 | ❌ **撤回** | 亲自读文件：该路由只导出 DELETE；GET 在 `download/`、`content/` 子路由且契约均有记载；`git log -S` 证实历史上从未有过该 GET。R4 机械比对再次确认 38 个路由方法与 37 个契约操作完全对齐 |
| R1：「幂等 resource-existence override 可导致旧响应重放」 | ⚠️ **机制修正** | 覆写 requestHash 后 commit 必然 P2002 → 整个事务连同覆写一起回滚，重放不可能发生。真实缺陷改为：该容错从不生效，异内容请求浪费整个事务后收到假 409（`idempotency/service.ts:195-204`；PATCH/DELETE 分支 144-163 为死代码） |
| R1：「分支从未跑过远端 CI」 | ⚠️ **表述修正** | 分支 tip `16ec09f` 已通过远端 CI（PR #1，run 34605407852，headSha 与本地 HEAD 一致）；未跑 CI 的是**未提交的 R12 修复** |
| R3：「ui-samples 受 layout NODE_ENV 门禁保护，生产不渲染」 | ❌ **撤回** | 亲自复核 `app/layout.tsx:34,44`：`isDev` 只门禁 `<StateSwitcher />`，`children`（含样例页）无条件渲染。见 P2-B3 |

---

## 2. 动态实证记录（全部实际执行）

| # | 检查 | 命令/方式 | 结果 |
|---|---|---|---|
| 1 | 门禁四件套 | `pnpm lint` / `pnpm typecheck` / `pnpm test:unit` / `pnpm test:contract` | ✅ 全过（267 unit、137 contract） |
| 2 | 全量集成（覆盖率模式 ×3） | 临时容器 `orbit-cov-mailpit`(25027/28027) + `vitest --coverage` | ✅ 312/312，57s，双库指纹不变；覆盖率已出（见 §4 测试） |
| 3 | 生产构建 | `pnpm build` → `artifacts/r3/build.log` | ✅ 零警告零错误，路由表完整 |
| 4 | 生产冒烟 | `next start` + curl 7 端点 | ✅ live/ready 200、`/` `/demo` `/auth/login` 200、`/api/v1/me` 401、`/app/today` 307+returnTo；**实测响应头仅 Referrer-Policy 一条** |
| 5 | 依赖审计 | `pnpm audit --prod/--json` | ✅ 0 漏洞（442/767 依赖）；仅 major 滞后（eslint 10/TS 7/Prisma 8-rc），无安全紧急项 |
| 6 | 秘密扫描 | 9 类模式 × 全部 19 个提交 + `--diff-filter=A` 凭证文件检查 | ✅ 干净；凭证文件从未入库；最大 blob 366KB（IDE 元数据） |
| 7 | 全量 E2E | 临时 Mailpit + `pnpm test:e2e --retries=0`（生产构建 + 3100 独立服务） | ✅ **77/77 通过**（2.2m），双库指纹不变 |
| 8 | 全量 UI | `pnpm test:ui --retries=0` | ✅ **13/13 通过**，指纹不变 |
| 9 | 空库迁移演练 | scratch 库 `orbit_migtest` + `db:migrate:deploy` | ✅ 14 迁移干净应用 |
| 10 | schema↔数据库漂移 | `prisma migrate diff`（Prisma 7 新旗标 `--from-config-datasource`/`--to-schema`） | ✅ **No difference detected** |
| 11 | 开发库数据不变量 | 只读 SQL：配额记账/任务编号/残留记录 | ✅ usedBytes/reservedBytes 精确一致、nextTaskNumber 一致、无过期租约/陈旧上传/待清理附件；ℹ️ 99 条过期幂等记录（维护脚本本地从未运行，符合运维设计） |
| 12 | 路由↔OpenAPI 机械比对 | 自写脚本 `route-openapi-diff.cjs` | ✅ 38 路由方法 vs 37 契约操作，唯一差异是有意 405 的 content HEAD；无未记载路由、无无路由操作 |
| 13 | 测试计数核对 | 逐文件统计 `it(/test(` + each 展开 | ✅ 267/137/312/77/13 = 806 精确吻合，无 skip/only |

覆盖率量化结果（R1.5，unit+contract 与 integration 取并集近似）：`src/server/**` 87.1% 行 / 77.0% 分支；`src/contracts/**` 93.5%；`src/lib/**` 87.3%；**`src/app/api/**` 55.6% / 34.7%**；`src/features/**` 4.1%（靠 E2E 兜底）；RSC 页面/组件 0%（仅 E2E 触达）。

---

## 3. 当前未解决问题清单（四轮合并去重）

严重级定义：P2 = 上线前应修复或明确接受；P3 = 打磨项/登记备查。

### 3.1 P2 —— 流程与工程基线

| # | 问题 | 位置 |
|---|---|---|
| A1 | **未提交变更集存在"部分提交即损坏"结构**：untracked `log.ts` 被已修改的 email.ts/options.ts 引用；`vitest.config.ts` 引用 untracked `integration-isolation.ts`；`.gitattributes` 未跟踪（CRLF 提交会破坏 backup 脚本 shebang）；R12 修复未跑远端 CI | git status 全景；`vitest.config.ts:54` |
| A2 | **4 个未使用的生产依赖**：`@tanstack/react-query`（README 已声明预留）、`sonner`、`react-hook-form`、`@hookform/resolvers`（后三个进审计面/镜像/安装时间） | `package.json:38,59,61` |

### 3.2 P2 —— 前端产品（对照 docs/02 规范）

| # | 问题 | 位置 |
|---|---|---|
| B1 | 真实数据页 `/app/today` 显示「fixture 合成数据」样例横幅；`isRealDataPath()` 白名单缺 today；注释自相矛盾（75 行声称 today 仍是 fixture，与 8 行外的白名单冲突） | `app-shell.tsx:62-78,321-322,382` |
| B2 | 全站无 error.tsx（除 `/app/today`）、无 global-error；7 个项目页把非 404 异常抛给框架英文默认错误页；除 today 外无任何 loading.tsx/Suspense | `src/app/**`（仅 `today/error.tsx`、`today/loading.tsx`） |
| B3 | **样例路由生产可达**：`/app/ui-samples`、`/app/samples/board/[projectId]` 对任何登录用户可用；页面注释声称的 NODE_ENV 门禁不存在（gate 只包 StateSwitcher），违反 docs/02 §8「仅开发环境可见」 | `app/layout.tsx:34,44`；`ui-samples/page.tsx:70-73` |
| B4 | 无 favicon/apple-icon/OG image/manifest，`/favicon.ico` 404 | `public/`（仅 screenshots） |
| B5 | iOS Safari 输入 <16px 自动放大：`--text-label:14px`/`--text-caption:12px` 用于几乎所有表单输入与评论/子任务 textarea | `tokens.css:62-64`；`input.tsx:26` 等 |
| B6 | 草稿保护缺口：`router.push`（侧栏"全部项目"、用户菜单）绕过拦截直接卸载脏面板；项目创建/任务创建/项目设置/个人设置四表单完全无保护 | `unsaved-changes.tsx:20-28`；各表单 |
| B7 | 移动端任务表格强制横向滚动（`min-w-880px`），违反 docs/02 §4「转为任务行卡片」；240 行注释还错误引用该文档自辩 | `task-list-client.tsx:240,258-259` |
| B8 | 移动端看板三列纵向堆叠，无 docs/02 §4 要求的状态 tab | `real-board.tsx:354` |
| B9 | 工作台空态/筛选态偏离 docs/02 §5/§7：无「创建一个项目」CTA、无「今天安排的任务已完成」完成态；任务页筛选无结果与真空态不区分、无清除筛选 | `task-list.tsx:26-29`；`task-list-client.tsx:182-206` |

### 3.3 P2 —— API 与契约

| # | 问题 | 位置 |
|---|---|---|
| C1 | `DELETE /comments/{commentId}` 返回 204，契约声明 200+Comment 正文；共享客户端空 200 体会抛错（按契约写的客户端在成功删除时报错）；`api-helpers.ts:9` 注释错误声称「所有 DELETE 返回 204」 | `comments/[commentId]/route.ts:82`；`contracts/client.ts:258-261` |
| C2 | `AcceptedInvitation` 响应含 `createdNewMembership`，openapi `additionalProperties:false` 不允许；Zod DTO（optional）与 openapi 互相矛盾 | `invitation/service.ts:354,387,405,458`；`dto.ts:184-187` |
| C3 | `revokeInvitation` 未做 UUID 前置校验（其他服务都有），非法路径参数 → 500 而非 404 | `invitation/service.ts:478-505` |
| C4 | E2E 清理缺 reset-password 分支：`db.ts` 只按邮箱删 Verification，重置令牌 identifier 是 `reset-password:<token>`；auth.spec 中途失败会残留并触发指纹隔离失败（与 R12-07 的 integration 侧修复不对称） | `tests/e2e/support/db.ts:191-194` |

### 3.4 P2 —— 安全与生产化

| # | 问题 | 位置 |
|---|---|---|
| D1 | `TRUSTED_PROXY_COUNT=0`（.env.example 默认值）在生产使 per-IP 限流塌缩为**全局单桶**——登录 10/min、匿名邀请 preview+accept 20/min 全体共享，一个攻击者锁死所有人；env.ts 无生产启动校验拦截 | `client-ip.ts:9`；`options.ts:166`；`write-limit.ts:68-77`；`env.ts:130-141` |
| D2 | 连接池耗尽（pg-pool 超时无 code）与 PG 连接上限（P2037）都落入 500；503 白名单里的 P2024 在 driver adapter 下是死代码。t3.micro 上池 max:5、看板单事务占一连接，5 并发即触发 | `errors.ts:132`；`prisma.ts:26-32` |
| D3 | 邮件发送失败被库静默吞掉（`runInBackgroundOrAwait` 吃异常），SMTP 故障时注册/登录/重置照常 200 而 UI 三处声称「已发送」；重复注册已有邮箱也不补发；**nodemailer 无任何超时配置**（默认连接 2min/socket 10min），黑洞 SMTP 可挂住认证请求线程 | `email.ts:55-63,184-188`；`register-form.tsx:39-42` |
| D4 | `/api/auth/*` 无请求体大小上限（better-call 直接 `request.json()`）；密码长度预检挡住 CPU 放大，内存尖峰仍在（1 GiB 目标） | `better-call/dist/utils.mjs:25`；`api/auth/[...all]/route.ts` |
| D5 | 全站安全头缺失：仅 `Referrer-Policy`（nginx 与 next 两层重复设置同一条）；无 CSP/frame-ancestors/X-Content-Type-Options/HSTS；当前 XSS 靠 React 转义+白名单 Markdown 结构性防住，但无纵深兜底 | `next.config.ts:15`；`infra/nginx.conf:8` |

### 3.5 P2 —— 测试质量

| # | 问题 | 位置 |
|---|---|---|
| E1 | 路由层覆盖真空：comments/subtasks/attachments 相关 **5 个 route.ts 在全部 Vitest 运行中 0% 执行**（评论 PATCH/DELETE、子任务 PATCH/DELETE、任务子资源 GET/POST），集成测试直调 service 绕过 HTTP 层；这些端点的校验/错误映射/状态码只有静态契约测试和 E2E happy path 兜底 | `tests/integration/m5-subresources.test.ts:3-15` |
| E2 | 两条关键并发路径从未执行：`resolveIdempotencyCommitConflict`（幂等提交冲突解析）、`renumberColumnAll`（看板间隙耗尽整列重编号，T-BOARD-03 明确要求集成验证） | `idempotency/service.ts:95-108`；`position.ts:71` |
| E3 | 契约一致性测试只比字段名（`type/required/format` 声明未使用）；枚举比对漏 `BoardColumn.status`；13 个请求 DTO（CreateProject/UpdateTask/CreateComment 等）完全无 openapi↔Zod 比对；错误码三份副本（openapi 自由字符串 / Zod 23 枚举 / docs/05 手工转写表）互不同步 | `openapi-consistency.test.ts:48-56,208-247`；`error-codes.test.ts:18-41` |
| E4 | `m2-envelope.test.ts` 是住在 contract 套件里的集成测试（真实 DB 读写），contract 项目**无** integration 的库名守卫/globalSetup——`pnpm test:contract` 依赖真实 Postgres 且误配无拦截 | `m2-envelope.test.ts:59-70,168-187` |
| E5 | 固定 sleep 负向断言可假通过（300/500ms 等待后断言旧响应未污染；同文件的 `page.clock.install` 才是正确范式） | `m3-workflows:324`；`m4-activity:404`；`m4-project-list:133` |
| E6 | 无覆盖率门禁（无 thresholds、provider 不在依赖、CI 不出报告）；生产 `requireTLS` 分支是生产-only 分支中唯一无测试的；m6-quality 的 p95 阈值环境绑定且实验室采样只收集不断言 | `vitest.config.ts`；`m6-quality.spec.ts:44-59` |

### 3.6 P3 —— 合并清单（按主题）

**服务端语义**
- 幂等容错从不生效（异内容 key → 浪费整事务后假 409；PATCH/DELETE 分支死代码）；并发重复 `clientUploadId` 的 P2002 → 400「上传表单不合法」、幂等过期记录竞态 P2025 → 500（均应为语义 409）
- 读路径 429 的 `Retry-After: 60` 硬编码（`errors.ts:108`），`session.ts:44` 丢弃真实 resetAfter（60s 窗口内是正确上界，但不精确且被测试锁死）
- 客户端可控 `x-request-id` 被回显进响应/日志（字符集安全，仅日志关联可污染）；content HEAD 405 是唯一不带 x-request-id 的响应
- `postgres-gate.release()` 在 finally 中失败会把成功上传变 500（租约 3 分钟自愈）
- 内存限流器窗口边界 ~2x 突发（`memory.ts:78-90`，仅非共享路径）
- Better Auth `update-user` 通道开放：`image` 字段直通落库、绕过应用写限流（UserDTO 白名单防住外泄）；建议校验或 disabledPaths
- `BETTER_AUTH_SECRET` 只验长度≥32；同一密钥复用为附件下载 HMAC（有域前缀，安全但轮换联动）
- 邮箱验证令牌为无状态 JWT：TTL 1h 内可重复使用并触发自动登录（与重置令牌的单次原子消费不对称）
- 用户 `name` 未过滤 Unicode bidi/控制字符（U+202E 可在成员列表视觉伪装）
- int4 版本计数器（Task.version/boardVersion 等）耗尽 → PG 22003 → 500（理论性）
- 逾期筛选游标指纹含 `today`：本地午夜后旧游标 400 INVALID_CURSOR（UX 瑕疵）
- 邀请重放跳过重授权（全项目唯一不重授权的重放路径，防御纵深偏差）
- 库级 verifyPassword 非常量时间比较（摘要级，不可修，仅记录）

**性能/资源**
- 任务列表/看板/工作台 `findMany` 拉全量 `description`（≤10000 字/行）再丢弃，满页 ~1MB
- GetObject 无服务端超时（Put 120s/Delete 15s/Get 0——SDK 默认全 no-op）；流中断后截断文件不可检测（无 Content-Length，可用 DB sizeBytes 修复）；不支持 Range（音视频 seek 全量重下）
- `/health/ready` 只查 DB 不查存储（MinIO 故障时 ready 仍绿）
- `IdempotencyRecord.resourceId` 更新无索引（评论删除热路径全表扫）——全部索引对齐审查中唯一缺口
- 重编号是事务内逐行 N 次 UPDATE 往返，间隙耗尽可能顶 10s 事务预算（宜改 `UPDATE...FROM (VALUES...)`）
- 无界增长无清理：过期/撤销 Invitation、MoveRecord（且 `getTaskMoveHistory` 是死代码）、软删除任务回收站
- 生产模式每页面加载 2+ 次 Postgres 限流写（池 max:5，需 micro 实测关注）

**前端/视觉/文案**
- 评论输入框 Escape 直接清空 2000 字草稿无确认（`comment-list.tsx:308`）
- 权限丢失遮罩：300ms 自动跳转使按钮不可达；403 也走「重新登录」流（登录页立即弹回）；样式整体脱离令牌（`bg-black/50`、`text-red-500`、不存在的 `bg-surface-secondary`、双 font-size 冲突、「您/你」混用）；无焦点陷阱
- 时间戳用设备时区（评论/附件/活动/邀请/回收站），与设置页「时区决定日期显示」承诺不一致
- SampleError 的「重试」按钮在真实错误态弹出「样例模式」toast（`state-views.tsx:31-43`，还引用从未使用的 TanStack Query）
- WCAG 对比度 4 处不达标：muted on sunken 4.35:1（看板计数/表头/归档 tab/邀请 dl）、on brand-soft 4.29:1、完成任务行 70% 透明度把辅助文字压到 2.75–3.11:1
- 6 处 "eyebrow" 装饰把内部 API 路径（含项目 UUID）大写英文渲染进 UI；设置字段 caption 同类
- 字节格式化双实现且都有 1024 边界 bug（`1024 KB` 应为 `1.0 MB`），精度还不一致
- 真实看板卡片标题未按 docs/02 两行截断（样例板反而截断了）；`shadow-popover` 用于静态表面违反「影子只用于悬浮层」
- 断点漂移：sm(640)/lg(1024) 与规范 md/xl 混用，真假看板三列起点不一致（lg vs md）
- 省略号 `...`/`…` 混用（3:51）；复制成功 toast 三种文案；空状态文风与 CTA 不统一（成员空态无「去邀请」引导）
- 忘记密码「重新发送」只是清空表单；任务删除确认非 danger 变体；`InviteAccept.tsx:180` 英文错误串；3 处校验错误未 aria-describedby；行内图标按钮 32px 低于自定 44px；无 skip-to-content；`/app` 无 page（404）；WorkbenchStats 卡片无 aria-current；登录/注册死 `networkError` 分支；pagination/tabs 组件仅样例页可达但进生产包；danger hover 方向与 brand 相反；tokens.css 注释对比度数字偏差（余量仅 0.05）；`dialog.tsx` 窗口级 Escape 与 timezone-picker 无 IME 防护（潜在）
- WorkbenchStats（docs/02 §5 的可点击筛选卡）无选中态样式

**测试（P3 级）**
- 选择器与中文文案强耦合（19 个 spec 仅 2 个 data-testid）；`boundary.test.ts` 只扫 `.ts`（server 端未来 .tsx 会逃逸 server-only 守卫）；auth.spec 死 beforeAll 清理 + 「统一文案」只测不存在账户单分支；m2-vertical 日志把测试库标成 dev 库；`rate-limit.test.ts:161` 永真断言 + 标题与行为矛盾；m2-vertical 持久化验证仅靠 reload+写状态码

**文档**
- `M6-OPERATIONS.md:33` 维护描述过时（每表 1000/每日 → 实际 10×1000/每小时 flock）；`docs/08:157`「11 个迁移」（实际 14，DEVELOPMENT-PLAN 继承）；`schema.prisma:224/348` 注释与迁移/CHECK 实际不符；`docs/03 §3` 预期目录树 3 处与现实不符（integrations/、features/comments|files、Dockerfile 位置）；`docs/12` 首条引用 learn.chatgpt.com 存疑、Prisma 7 升级路径不符官方结构、缺 Nodemailer 行；docs/02 §3 路由名与实现漂移；`tx.ts:23` 超时注释过时；`docs/05` 的 EMAIL_UNVERIFIED/ALREADY_EXISTS 两错误码从未抛出；`api-helpers.ts:9` DELETE 语义注释错误

**工程/仓库**
- 死代码：`rate-limit/redis.ts`、`position.ts:137`、`today-view.tsx`+`today/fixtures.ts`、`board-view-client.tsx`、`lib/conflict-handler.ts`、4 个零引用 barrel、`tasks/fixtures.ts` 死导出、`formatDueShort`、`attachments/access.ts` 大部分函数（validateFileType/countActiveAttachments 等无调用）、`src/app/api/v1/workbench/` 空目录
- `.qoder/`+`.kiro` ~78 个 IDE 生成文件入库（最大 366KB）；`next-env.d.ts` 被跟踪（Next 16 明确要求忽略）
- 无 dependabot（依赖更新全手动）；`engines` 无 `.npmrc engine-strict` 强制；Node 版本面松弛（engines>=24 / CI 浮动 24 / Docker 锁 24 / 本机 26）
- `.dockerignore` 缺 `src/generated`、`coverage`、`*.pem/*.key`
- CI：audit 只扫 prod 依赖且非确定性；Playwright 浏览器无缓存（~1min/次）；对 orbit_dev 的 `db:migrate:deploy` 是死步骤
- nginx 无 upstream keepalive（环回，影响小）；备份脚本 sha256 只存不校验（仅核长度）；备份 bucket 生命周期含 noncurrent 规则但指南漏「开启 Versioning」
- `playwright.config` `trace:"on-first-retry"` 在 retries:0 下死配置（宜改 retain-on-failure）；`e2e-server.mjs` POSIX 进程组杀死失效（无 detached，Linux 失败路径可残留 3100 端口进程）；recovery-drill/maintenance-cleanup 失败时吞根因（退出码正确）；`proxy.ts:75` 注释声称处理 /auth 回跳实际没有

---

## 4. 四轮验证为干净的领域（高置信结论）

- **注入与数据访问**：24 处 `$queryRaw/$executeRaw` 全参数化零注入；两处 `$queryRawUnsafe` 均固定串+绑定参数；`::uuid` 转换全部前置校验；ILIKE 通配符转义一致；游标防篡改靠形状校验兜底成立；ILIKE/游标/锁顺序均无 500 通道（唯一例外 C3）。
- **事务与并发**：所有读改写在 Project/User 行锁内；nextTaskNumber 原子 UPDATE…RETURNING；看板 RepeatableRead + boardVersion 409；幂等记录与业务写同事务；上传三段式（预留 tx → S3 流 tx 外 → 终态 tx）+ 失败补偿 + 崩溃回收器 + 3 分钟租约自愈；bigint 位置无溢出；配额记账在真实开发库上精确一致（实测）。
- **授权**：25/25 个 /api/v1 路由有会话校验；proxy 唯一豁免的 multipart 路径在路由内补偿；成员/邀请/评论/附件的 owner/member 语义逐路由核对无误；归档只读全链路生效；notFound 统一不泄漏资源名。
- **认证**（对照 better-auth@1.7.3 库源码逐项验证）：枚举防护三流全到位（含时序对齐）；重置令牌单次原子消费 + 全会话吊销；CSRF/Origin 强制开启且无 Origin 的写请求 403；IP 只读受信包装头、nginx 覆写 XFF；scrypt 参数与长度预检；密码重置链接 token 24 位字母数字 URL 安全；邮件 HTML 全部 escapeHtml；签名下载 URL 绑定下载者+取时重授权+expires 进 HMAC，五类滥用有测试。
- **运行时**（对照 next 16.3.4 / smithy 源码）：客户端断开正确中止 S3 流；SIGTERM 排空与 150s 预算对齐；env 校验失败即退出且日志只含变量名；statement_timeout/lock_timeout/timezone=UTC 会话级固定。
- **前端**：键盘全流程可达（含拖拽键盘替代与状态菜单）；焦点陷阱/返回全覆盖；自动刷新不覆盖编辑草稿（data-task-editing 守卫 + 版本快照）；401 硬跳转带净化 returnTo；reduced-motion 全局规则压倒 dnd-kit 内联过渡；长文本溢出处理全覆盖；67 个 "use client" 无一误标；系统字体零 FOUT/CLS；lang=zh-CN；页面 title 元数据齐全。
- **测试套件**（质量审计结论）：计数 806 精确吻合；集成零 DB mock（vi.mock 全部重绑真实测试库）；15/26 集成文件走真实路由处理器；E2E 断言验证服务器状态（API 读、DB 直查、字节级下载比对、objectKey 泄漏检查）；清理精确 + 双库指纹兜底；database-isolation.spec 是写穿探针非重复。
- **供应链/仓库**：Git 全历史无秘密、凭证文件从未入库；audit 0 漏洞；Dockerfile digest 锁定 + 非 root + HEALTHCHECK；eslint 仅 3 处 disable 且全部正当（硬编码同源跳转）；零 @ts-ignore；文档链接 0 坏链；.env.example 与 env.ts 完全对齐；scripts 全部跨平台可移植；规划校验 PASS；历史快照 15 个标签机器级核对全对。

---

## 5. 最终行动清单（合并四轮，按优先级）

1. **整批原子提交 + 远端 CI**：全部 45 条工作区条目一次提交（含 `.gitattributes` 与 backup 脚本同批），验证 fresh clone 可跑通；此后远端 CI 覆盖 R12+ 审查期全部修改。
2. **生产化三件事**：`toErrorResponse` 补 P2037/pg-pool 超时映射 → 503；SMTP 显式超时 + `advanced.backgroundTasks.handler`（或失败面修正）+ `onExistingUserSignUp` 补发；`/api/auth/*` 体积上限（nginx 覆盖 auth 路径或库层）。
3. **P2 交互批**：today 横幅白名单（+删 TodayView 死代码）、全局 `app/error.tsx` + 各路由 `loading.tsx`、iOS 16px（输入类令牌提至 16 或 input-only 覆盖）、草稿保护覆盖 router.push 与四表单、样例页门禁修正 + 注释/文档对齐、favicon/apple-icon/OG、移动端任务表格卡片化与看板状态 tab、工作台空态 CTA/完成态/筛选空态。
4. **契约对齐 + 契约测试升级**：评论 DELETE（改路由回 200 或改契约 204 + client 适配）、AcceptedInvitation（openapi 加字段或服务端去掉）、revokeInvitation UUID 校验、E2E db.ts 补 reset-password 清理；一致性测试升级为比类型/必填/枚举（含 BoardColumn.status）/13 个请求 DTO，错误码以 Zod 为源生成另两份；m2-envelope 迁回 integration 或给 contract 补库名守卫。
5. **测试缺口批**：5 个 0% 子资源路由的 Request 直调测试（422/409/413/404 分支）；幂等并发提交与间隙耗尽重编号两个竞态测试；requireTLS 分支测试；固定 sleep 改 `page.clock`；性能阈值注入化 + 实验室样本断言；CI 加信息性覆盖率报告。
6. **清理批**：4 个未用依赖、`.qoder/.kiro` 出库 + next-env.d.ts 忽略 + dependabot、§3.6 死代码全清单、文档漂移归一（M6-OPERATIONS/docs:08/docs:03/docs:12/schema 注释/错误码表）。
7. **打磨批**：对比度 4 处、PermissionLossOverlay 重做、GetObject 超时 + Content-Length（+可选 Range）、resourceId 索引、重编号批量 UPDATE、eyebrow 内部路径移除、文案/空态/省略号统一；其余 §3.6 按此消化。
8. **M6 生产部署验收**：按 AWS micro 指南应用全部配置后完成 HTTPS 双账户、容量、备份恢复与次日异地备份核验——以上所有本地结论不替代生产验收。

---

## 6. 审查方法与局限性

- 四轮静态审查均基于工作区快照（零变动），动态实证在 Windows / Node 26.8.1 本机执行；**不构成生产环境验收**（t3.micro 容量、HTTPS、SES/S3 真实联调、RPO/RTO 仍待 M6 部署后验证）。
- 覆盖率数字为 unit+contract 与 integration 两次运行的并集近似；E2E/UI 的浏览器层覆盖未量化（77+13 项行为断言为准）。
- 对照库源码的语义结论（better-auth 1.7.3、nodemailer 10、smithy、pg-pool、next 16.3.4）以 node_modules 安装版本为准；升级依赖后需复核。
- 本报告只记录审查发现，未修改任何业务代码；所有临时测试资源（coverage provider、Mailpit 容器、scratch 数据库、构建产物）均已清理还原，工作区保持 45 条原始 git 状态。
