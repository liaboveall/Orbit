# 全项目审查修复与优化 · 2026-09-11

本轮对应 [全项目深入审查](PROJECT-DEEP-REVIEW-2026-09-11.md) 的 R01–R09。完成实现、迁移、正式回归和本地验收；不包含 M6/M7 新功能或生产发布。**R01–R09 全部关闭，M0–M5 恢复 done；M6/M7 保持 todo。**

## 修复清单

| 问题 | 最终行为与主要文件 |
|---|---|
| R01 认证 IP 信任 | `src/server/auth/options.ts` 在真实 handler 前清洗内部 IP 头，复用 `resolveClientIp`。无可信代理时共享固定桶，伪造转发头不能换额度；已配置多跳代理使用选定来源。真实认证 handler 测试覆盖轮换头、伪造内部头和不同可信来源。 |
| R02 后台失败丢草稿 | 评论/子任务区分首次读取错误与后台错误。后台网络失败、500 只显示局部错误，编辑组件持续挂载；重试、远端版本变化后保留原文字和 expectedVersion，保存仍正确触发版本冲突。 |
| R03 提交回调清空新输入 | 新评论、新子任务及行编辑在请求期间冻结输入，失败恢复可编辑并保留草稿；锁防重复提交，取消不能绕过在途行保存。 |
| R04 详情关闭保护 | `unsaved-changes.tsx` 按用户和任务隔离登记父任务、评论、子任务、附件选择及在途操作。关闭确认、链接导航、浏览器后退/卸载均检查草稿；上传卸载时取消，弹框明确提示已发出的保存可能完成。 |
| R05 分页与排序 | `use-paged-tasks.ts` 统一工作台/项目列表的分页范围刷新；同上下文保留内容与高度，用新游标重取已加载范围，取消过期请求；账号、项目、筛选变化重置。看板同样补齐已加载列，刷新或移动后保持排序所需范围。 |
| R06 删除评论重放 | 删除事务将创建幂等缓存改为删除占位；重放优先检查当前删除状态。已删除正文不再由原 POST 重放返回。补充旧缓存清理迁移，同步 OpenAPI、数据和 API 规范，明确该例外优先于原响应重放。 |
| R07 UUID 幂等 | 评论/子任务创建路径在生成 routeKey 前规范化 UUID；大小写等价路径只产生一份资源与活动，不同内容继续返回 409。竞争重试重新进入锁和权限校验。 |
| R08 时间存储 | 38 个事件时间列改为 `Timestamptz(3)`，`dueDate` 保持 Date；旧值显式按 UTC 转换。应用连接固定 UTC，与锁定 adapter-pg 的解析约定一致。 |
| R09 上传限额 | 独立滑动窗口 10 次/用户/分钟、跨任务最多 2 个在途请求。准入发生在 multipart 读取前，准入后的失败和重放计频率；成功、失败、取消和超时由 finally 释放并发名额。 |

## 验证中追加解决的问题

**Next Proxy 阻塞流式上传。** 已安装 Next 16.3.4 文档 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md` 及 `server/body-streams.js` 表明 Proxy 会复制并缓冲整个请求体，等接收结束后才进入路由。真实慢上传测试最初因此失败：路由未启动，数据库中无 UPLOADING 记录。`src/proxy.ts` 现在排除附件集合端点，两种方法继续由路由执行权威会话/资源权限检查。真实 HTTP 回归验证两个不同任务并发上传时第三条立即 429，取消一条后能再次上传，最终没有残留预留和夹具。

**测试夹具无谓等待。** E2E/UI 均使用强制 APP_ENV=test 的隔离 runner，但旧注册夹具仍每 8 次等待约一分钟，导致历史单例约 51 秒。移除该过时等待，未改变服务端认证策略；真实认证限流由开启限流的独立实例验证。前一轮全量 63 E2E 为 1.6 分钟，零重试；该耗时是测试执行效率，不能当作产品 p95。

**历史导航监听顺序。** 仅恢复 popstate 地址不足以保护已开始卸载的组件。现代浏览器使用 [Navigation navigate 事件](https://developer.mozilla.org/en-US/docs/Web/API/Navigation/navigate_event) 在历史导航前确认；兼容路径通过 `src/instrumentation-client.ts` 在 hydration 前安装历史守卫，先于 App Router 的 Window 监听器执行，避免框架先卸载草稿。现代 API 与模拟无 API 两种模式下，评论/子任务编辑后取消后退的 4 项真实浏览器测试通过。

## 数据迁移安全与兼容性

- 新增 `20260911120000_event_times_timestamptz` 和 `20260911121000_scrub_deleted_comment_replays`，未改写已存在迁移。
- 两库迁移前默认时区均为 Etc/UTC。旧代码的 Date 与当前数据库默认事件时间均按 UTC 解释；显式 `AT TIME ZONE 'UTC'` 避免迁移会话时区隐式改变值。
- 排除预期变化的 `_prisma_migrations` 后，开发库 690 行、测试库 58 行的全表归一化内容指纹迁移前后完全一致。两库待清除的历史已删除评论缓存正文均为 0；清理迁移仍供旧数据环境使用。指纹仅输出摘要，不记录密码、令牌或用户正文。
- 在新建随机命名的隔离空库上执行所有迁移，随后 `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` 无差异；仅删除本次成功创建的隔离库。
- adapter-pg 7.10.0 的 `normalize_timestamptz` 将返回文本的时区后缀直接规范为 UTC，并不转换墙上时间，因此只改列类型不足以确保 ORM 解析正确。应用池已明确 `timezone=UTC`。测试在 UTC / Asia/Shanghai / America/Los_Angeles 下比较数据库 epoch，再恢复池约定检查 Prisma Date，并单独断言应用连接时区。
- Prisma DateTime 与原生类型映射核对 [当前 PostgreSQL 连接器文档](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql) 和已安装 7.10.0 实现；Better Auth 的 Date 输入/输出及真实认证链路回归通过。

## 实际验收证据

| 命令/验证 | 结果 | 日志 |
|---|---|---|
| pnpm check | lint、typecheck、264 unit、137 contract 通过 | artifacts/fix-review-check-final.log |
| 最后补充修改后的 pnpm lint | 通过 | artifacts/fix-review-lint-final.log |
| pnpm test:contract（契约描述同步后） | 137 通过 | artifacts/fix-review-contract-final.log |
| pnpm typecheck:scripts | 通过 | artifacts/fix-review-scripts-final.log |
| pnpm test:integration（隔离包装器） | 23 文件、306 项通过 | artifacts/fix-review-integration-final.log |
| E2E_PORT=43127 pnpm test:e2e | 最终全量 67 通过、零重试，57.3s | artifacts/fix-review-full-e2e.log、fix-review-full-e2e-final.log |
| E2E_PORT=43127 pnpm test:ui | 最终 13 通过、零重试，16.1s | artifacts/fix-review-full-ui-final.log |
| pnpm build | E2E/UI runner 生产构建通过 | 对应浏览器日志 |
| 新库 migrate deploy + diff | 通过，无差异 | artifacts/fix-review-fresh-db.log |
| 开发库/测试库迁移 | 两次增量迁移已应用，原数据归一化指纹一致 | artifacts/fix-review-migration-before.json、fix-review-migration-development.log、fix-review-migration-test.log |
| 集成及浏览器隔离 | 夹具清理后两库内容指纹一致 | 对应套件日志末尾 isolation |
| 规划检查 | 通过：117 Markdown、96 本地链接、37 操作、25 任务 | artifacts/fix-review-plan.log |

新增正式回归：`tests/integration/review-regressions.test.ts`、`tests/e2e/review-regressions.spec.ts`、`tests/unit/upload-gate.test.ts`。旧诊断探针仍是历史缺陷断言，不纳入验收套件。

## 范围与后续

本次关闭已发现的 R01–R09，M0–M5 恢复本地验收完成；M6/M7 保持 todo，下一步 M6 / ORB-020。上传及现有业务限流仍为单实例实现，多副本上线前必须按既定 PostgreSQL 方向共享计数。可信代理部署须阻止直连源站，并正确追加/清洗转发头，不能仅设置 TRUSTED_PROXY_COUNT 就假定网关可信。

本轮未声称完成生产 CI/容器发布、共享限流、备份恢复、维护调度、真实并发 p95 或完整可访问性终验。这些为既有 M6 交付范围。大量历史评论的发布后全页重读仍需纳入 M6 性能验收，不能由本地功能测试推导生产负载达标。

仍无初始 Git commit；本轮未提交、推送或部署。日志中的 Node 26 localStorage/NO_COLOR 提示和有意断流产生的 stream closed early 仍如实保留，未用重试或跳过断言掩盖失败。
