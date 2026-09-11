# M1 独立复核记录

## 修复后复验（2026-09-09，Codex）

**当前结论：R1—R3 均已修复，M1 验收通过。** M1 与 ORB-004/005/006 为 done。本轮按用户要求仅完成 M1，未启动 M2。

- R1：移除按 Cookie 存在性拦截登录/注册页的重定向；页面检查真实数据库会话。proxy 向受保护布局传递原路径和查询参数，失效会话重登录仍可回到原页。
- R2：Better Auth 数据库创建/更新钩子统一校验姓名与时区，直接请求认证库端点也无法绕过。历史非法姓名或时区仅在 DTO 投影时提供合法显示值，不静默改库，不把有效身份变为 401；用户可在设置中修复。
- R3：注册提交浏览器 IANA 时区，服务端校验与归一化；缺失或非法字符串回退 Asia/Shanghai。重新登录保留已设置时区。
- 同步纠正验证邮件“一次性”文案：验证 JWT 在有效期内幂等，重设密码令牌仍为单次使用。

| 实际命令 | 修复后结果 |
|---|---|
| `pnpm check` | exit 0；lint/typecheck、49 unit、121 contract |
| `pnpm test:integration` | exit 0；4 文件、75/75，真实 orbit_test + Mailpit |
| `$env:E2E_BASE_URL='http://localhost:3000'; pnpm test:e2e` | exit 0；5/5，零跳过 |
| 同一开发服务的 `pnpm test:ui` | exit 0；13/13 |
| `pnpm build` | exit 0；生产构建成功，登录/注册为动态服务端页面 |

新增持久回归在 `tests/integration/auth-flow.test.ts`、`tests/integration/me.test.ts` 与 `tests/e2e/auth.spec.ts`：非法注册/更新姓名被拒且不落库；40 字边界及 trim；时区有效值/非法值/缺失值；旧资料 GET 200、读取不改库及 PATCH 修复；纽约浏览器真实注册；设置东京时区；真实密码重设撤销旧会话后，同一浏览器携带旧 Cookie 成功重新登录并回到原路径；登录后时区仍为东京；伪造 Cookie 可访问登录和注册页。

验证边界：浏览器回归使用现有开发服务，生产模式只执行构建。本轮无迁移或业务 API 契约变更，未清库、未提交。下方为修复前审计历史，不代表当前状态。

---

## 修复前独立复核（历史）

日期：2026-09-09。范围：验证已有 M1 认证与个人设置实现；本次未修复应用代码、未实施 M2。

## 结论

**M1 主体实现已完成，正常流程与现有测试通过，但目前不能无条件关闭验收。** 本次确认 1 项 P1、2 项 P2：失效 Cookie 导致登录重定向循环；认证库更新用户端点绕过姓名约束并使账户失去业务访问能力；首次注册未使用浏览器时区。

建议当前状态为 `M1_REVIEW_CHANGES_REQUIRED`，M1 为 `review`。ORB-004 的迁移、会话与 HTTP 基础检查通过，保留 `done`；ORB-005、ORB-006 回到 `review`，处理下述问题后复验。M2 暂不开始。

| 任务 | 本次判断 | 说明 |
|---|---|---|
| ORB-004 认证与数据库基础 | 已验证的基础范围通过 | 两个迁移已应用；会话隔离、Origin、requestId 集成检查通过。下述修正仍可能涉及其公共认证代码 |
| ORB-005 认证全流程与邮件 | review | 正常注册/验证/登录及密码重设可用；R1 阻断失效会话的重新登录，R3 缺少注册时区采集 |
| ORB-006 个人设置与缓存清理 | review | 正常设置持久化、非法时区拒绝及退出通过；R2 存在另一条可写入非法姓名的路径 |

## 本次实际验证

环境：Windows，Node v26.8.1，pnpm 10.34.5，Next.js 16.3.4，Better Auth 1.7.3。应用使用已运行的 `http://localhost:3000` 开发服务；数据库为本地 `orbit_dev` / `orbit_test`（端口 5433），SMTP 指向本地 Mailpit（25025），Mailpit API 为 8025。

| 检查 | 本次结果 |
|---|---|
| `pnpm check` | exit 0：lint、typecheck、49 unit、121 contract |
| `pnpm build` | exit 0，认证路由、/me、设置页及 Proxy 成功构建 |
| `pnpm test:integration` | exit 0，4 文件、66/66；真实 orbit_test 与 Mailpit，包括重设密码后撤销旧会话、令牌边界、账户隔离 |
| `pnpm exec prisma migrate status` | exit 0，两个迁移存在且 orbit_dev schema up to date |
| `$env:E2E_BASE_URL='http://localhost:3000'; pnpm test:e2e` | exit 0，4/4，零跳过；首页、匿名门禁、错误登录、真实注册/邮箱验证/自动登录 |
| 同一服务的 `pnpm test:ui` | exit 0，13/13；带真实认证前置的 M0 界面回归 |
| 现有 `scripts/m1-e2e-verify.ts` 的独立输出副本 | exit 0，Flow A–E 全通过，15 条 PASS、18 张截图；注册/验证/登录、设置修改与刷新持久化、非法时区、退出、键盘操作 |
| 补充真实浏览器注册/密码重设检查 | 正常重设成功，旧会话 API 401，新浏览器使用新密码登录成功；同时复现 R1、R3 |
| 补充真实 HTTP 资料边界检查 | 复现 R2；已将该合成测试账户的姓名恢复为合法值并退出 |

现有测试通过证明的是它们覆盖的路径，不能替代本次新增边界检查。数据库集成中的“旧会话 API 返回 401”和“旧 Cookie 用户能打开登录页”是不同断言；目前前者通过、后者失败。

本次未重做干净安装、Node 24 验证、空库迁移重放、生产进程启动/生产环境浏览器验证、完整无障碍审计或真实部署。MinIO 容器 healthy，但 M1 不涉及附件上传，未将其健康状态当作存储业务联调证据。

## R1 · P1：失效会话 Cookie 使登录页与工作台无限重定向

位置：`src/proxy.ts:86`、`:106`；与 `src/app/app/layout.tsx:38` 的权威会话检查形成循环。

原因：Proxy 仅凭 Cookie **存在**就把登录页请求重定向到 `/app/today`；应用布局发现会话过期、撤销或无效后又重定向到登录页。Cookie 仍在，下一次请求再次被 Proxy 拦回工作台。

本次两种方式均已复现：

1. 使用无效的 session Cookie 请求页面。
2. 新建真实已验证测试账户，保存其真实 Cookie，在服务端退出撤销会话，再使用旧 Cookie 请求。旧 Cookie 访问 `/api/v1/me` 返回 401，页面则循环。

实际 HTTP 跳转序列：

```text
/auth/login                              307 -> /app/today
/app/today                               307 -> /auth/login?returnTo=%2Fapp%2Ftoday
/auth/login?returnTo=%2Fapp%2Ftoday        307 -> /app/today
/app/today                               307 -> /auth/login?returnTo=%2Fapp%2Ftoday
```

补充浏览器验证还确认：在已登录浏览器中通过真实邮件完成重设密码后，界面显示“密码已重设”，旧会话 API 已失效，但同一浏览器请求登录页仍得到 307 → `/app/today`。新浏览器使用新密码可以登录。

影响：会话过期、其他设备退出、密码重置等正常场景下，用户无法重新登录，往往需要自行清除 Cookie。

修正方向：不能用 Cookie 存在性将用户挡在登录表单之外。将“已登录跳过登录页”的决定交给真实会话检查，或允许登录页到达后由服务器判断。确保失效 Cookie 有可恢复的路径；保留合法 returnTo。不要只在当前浏览器退出时清 Cookie，因为它不能解决其他浏览器留下的旧 Cookie。

复验：真实过期/撤销 Cookie、伪造 Cookie 和重设密码后的旧 Cookie 都能到达可用的登录页；旧 Cookie 的业务 API 仍返回 401；合法会话仍可正常进入应用；不存在循环跳转。

## R2 · P2：认证库自带资料更新接口绕过姓名约束

位置：`src/app/api/auth/[...all]/route.ts:21` 无限制挂载库端点；`src/server/auth/options.ts:71` 附近没有统一姓名写入校验；`src/server/auth/session.ts:35`—`:45` 将非法资料判为未认证。

同一个真实已验证账户的实际请求结果：

| 操作 | 实际结果 |
|---|---|
| 初始 `GET /api/v1/me` | 200 |
| `PATCH /api/v1/me`，name 为 41 个字符 | 400，符合预期 |
| `POST /api/auth/update-user`，同样 41 个字符 | **200，接受写入** |
| `GET /api/auth/get-session` | 返回有效会话，其 user.name 实际长度为 41 |
| 再次 `GET /api/v1/me` | **401** |
| 经认证库端点将测试姓名恢复为合法值后再 GET /me | 恢复 200 |

原因：业务端点的 schema/白名单只保护 `/api/v1/me`；认证库的另一个写用户入口没有同样规则。`safeParse` 返回 null 只是把资料错误转成登录失效，并没有修复导致非法资料落库的原因。注册表单的 maxLength 同样不能代替服务端所有写入路径的约束。

影响：同一账户存在相互矛盾的“会话有效/业务未登录”状态；非法值可经真实 HTTP 接口落库，随后设置页本身也不可访问，并可能触发 R1。

修正方向：在所有允许的用户创建/更新入口统一执行 1—40 字符与空白处理规则，或明确关闭产品不需要的库端点；区分认证身份有效性与资料校验失败，提供已有异常资料的恢复方式。补测认证库公开端点，不能只测 `/me`。本次直接复现的是 update-user 路径，注册等其他写入路径也需在修复时检查。

复验：通过任何公开入口提交空白/超长姓名都被拒绝且数据库未变；既有会话仍能正常使用；40 字符边界通过；合法姓名与时区修改刷新后仍持久化。

## R3 · P2：首次注册忽略浏览器 IANA 时区

依据：`docs/01-PRODUCT-SPEC.md:25` 明确要求首次注册使用浏览器合法 IANA 时区，无法识别时才回退 Asia/Shanghai。

位置：`src/features/auth/use-auth.ts:83`—`:91` 的注册 payload 只有 name/email/password；`src/server/auth/options.ts:74`—`:80` 将 timezone 设为 `input:false` 并固定默认值。

本次使用真正的浏览器上下文、将时区设置为 `America/New_York`，通过注册页面提交并用 Mailpit 验证邮箱，随后读取 `/api/v1/me`：

```json
{
  "browserTimezone": "America/New_York",
  "submittedTimezone": null,
  "storedTimezone": "Asia/Shanghai",
  "registerStatus": 200
}
```

因此这不是只缺一条测试，而是规格中的注册行为尚未实现。旧交接已把它记作“推迟到 M2”，但这是一项已确定的账户要求；该交接记录不等同于用户批准修改验收范围。

修正方向：首次注册采集浏览器时区，服务端执行合法 IANA 校验和规范化，无法识别时采用约定回退；不要直接开放一个不校验的任意 timezone 字段。用户之后明确保存的时区不能被登录时设备值覆盖。

复验：America/New_York、Asia/Tokyo 等合法浏览器时区注册后正确保存；未知或缺失值回退；非法客户端值不进入数据库；修改时区后再次登录不被覆盖。

## 其他记录与范围

- README 仍写 ORB-005 待补 E2E，PROGRESS/backlog 却已标记全部 done，描述不一致。本次已重跑现有 E2E，所以现在的阻断是上述实际问题，不是未执行原有脚本。
- TanStack Query 延后、Auth 页面采用 `/auth/*` 前缀、生产介绍页入口等是交接与后续整合事项，本次没有把这些技术选择升级为认证故障。
- 验证邮件文案仍称“仅可使用一次”，而现有配置/交接说明验证 JWT 为幂等；后续应统一文案与实际语义。密码重置令牌的单次使用测试与之不同，不能混写。
- 工作台、看板和任务内容仍是明确标注的 fixture；真实项目/任务业务属于 M2+，不是本次 M1 未完成的理由。
- 当前仓库所有项目文件仍为 untracked，无可引用的提交基线；本次没有暂存、提交或清库。

## 证据与副作用

已有浏览器验证脚本仅复制到 `artifacts/m1-review-2026-09-09/browser-verify.ts` 并修改输出路径，原始脚本/历史截图未覆盖。新输出位于该目录的 `browser/`，汇总 `summary.json`；补充浏览器检查与结果为 `timezone-reset.mjs`、`timezone-reset-results.json`。

补充 HTTP 观察记录在同目录 `http-observations.json`。Cookie/令牌只在检查进程内使用，报告不包含凭证。测试邮件全部投递到本地 Mailpit，未发送外部邮件。E2E 与补充检查会在开发库留下唯一的 `@orbit.test` 合成测试账户及 Mailpit 邮件；数据库集成测试按其 RUN_TAG 清理自身夹具。未修改用户已有账户。

本次只更新验收文档和状态。下一步先修复 R1—R3、补充能捕获这些边界的回归测试，验证通过后再将 M1、ORB-005、ORB-006 恢复 `done` 并进入 M2 / ORB-007。
