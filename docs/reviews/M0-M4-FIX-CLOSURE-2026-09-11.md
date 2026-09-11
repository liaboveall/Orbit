# M0–M4 修复关闭与 M5 准入

日期：2026-09-11。范围：修复本轮独立审查发现的问题，不实施 M5。

**结论：A01–A07 已关闭，M0–M4 done，M5 可从 ORB-016 开始。** 本结论取代修复前的准入判断；历史报告保留，不将历史失败改写成通过。这里的“通过”指本地开发准入，不代表 M6 生产部署验收已完成。

## 修复与回归

| 编号 | 最终行为 | 正式证据 |
|---|---|---|
| A01 | 任务 409 后保留本地草稿及原版本；GET 成功展示远端标题和描述，保存仍禁用。明确选择采用远端或保留本地后才推进编辑版本；再次保存仍由服务器校验 version。 | `tests/e2e/m4-audit-regressions.spec.ts` 验证独立页标题与侧面板描述，比较前禁止保存，比较后验证数据库字段与 version=3；`m3-workflows.spec.ts` 保留原有冲突流程。 |
| A02 | 补齐邀请列表 GET，owner 权限、归档可读、严格查询校验、稳定 createdAt/id 游标分页、跨项目游标拒绝；不输出令牌字段。 | `tests/integration/invitations.test.ts`：401/403/404、移除成员、非法查询、同时间分页、跨项目游标、归档和严格响应 schema；E2E 验证真实 GET 200。契约测试新增 M0–M4 全部 22 个操作的 HTTP 导出检查。 |
| A03 | Escape 只关闭当前确认框，保留详情与草稿并恢复焦点。 | `tests/ui/m0-review.spec.ts`：390/768/1440px 确认、焦点、遮罩和断点切换；真实 TaskPanel E2E 通过。 |
| A04 | 先用完整 IP 校验，再规范化 IPv6；点分、十六进制及展开形式的 mapped IPv6 统一至 IPv4 限流桶。 | `tests/unit/client-ip.test.ts` 拒绝畸形 mapped 地址、前导零、空段、代理链不足及 zone ID，并验证等价地址。 |
| A05 | 预览网络/429/5xx 失败保留本标签页令牌，提供重试，刷新可恢复；终态及接受成功仍清除。 | 正式 E2E 分别注入 429/500/503，失败重试后解除拦截并刷新，恢复真实预览。既有邀请创建、复制、接受与撤销闭环通过。 |
| A06 | R1 套件按精确邮箱清理，连 setup 中途失败也能记录清理目标；三个用例真实制造冲突与 GET network/500/503，不再只查正常按钮。 | 完整 E2E 45 passed，命令 exit 0；global teardown 确认两库内容指纹未变。 |
| A07 | backlog 合法 JSON，README、PROGRESS、当前任务和准入状态一致；历史声明归入历史记录。环境文档纠正 UI/E2E 复用与隔离说明，规划阅读副本重新生成。 | `planning/validate_plan.py`；本报告与 PROGRESS 为当前交接入口。 |

关键实现：`src/features/tasks/real/task-editor.tsx`、`src/components/ui/dialog.tsx`、`src/features/invitations/InviteAccept.tsx`、`src/server/http/client-ip.ts`、`src/server/modules/invitation/service.ts`、`src/app/api/v1/projects/[projectId]/invitations/route.ts`。

Escape 首次修复未通过真实浏览器，未因此放宽断言。定位时记录到外层 Drawer 收到 Escape、内层 Dialog 未收到。最终由共用 Dialog 在 document 捕获之前，按焦点所属弹层处理 Escape，并排除 menu/listbox；保留调用方取消默认关闭的能力。当前 Radix 1.1.23 的这条兼容处理需在未来升级时重新验证。

## 附加收尾

- 停用 `scripts/cleanup-migration.ts` 及对应历史 SQL 的删除迁移记录、DROP TRIGGER/FUNCTION 操作。运行旧 TypeScript 入口只返回明确失败，不连接数据库；没有改动当前迁移文件或迁移历史。
- `scripts/cleanup-invitation-tokens.ts` 默认只读统计。应用变更需 `--apply --database=<精确数据库名>`，事务内清理旧参数路径和当前真实项目路径，使用 OR 检测任一泄露字段；失败非零退出，不输出驱动错误原文。真实测试库验证只读、错误目标拒绝、清理两种路径、保留无关记录。开发库只读扫描候选数为 0，未执行清理。
- 精确替换 mysql2 3.15.3 → 3.23.1，以及仅供 @prisma/config 7.10.0 的 deepmerge-ts → 8.0.0，保留 Prisma 7.10.0。已核对上游变更与当前配置使用方式，锁文件同步；兼容性依据与公告见 [版本记录](../versions.md)。没有通过审计忽略项隐藏告警。

## 实际门禁

最终执行均 exit 0；E2E/UI 使用 `--retries=0`，串行运行数据库相关套件。

| 命令 | 结果 | 本轮日志 |
|---|---|---|
| `pnpm check` | lint、strict typecheck；259 unit、137 contract | `check.log` |
| `pnpm test:integration` | 258 passed / 19 files，真实 PostgreSQL | `integration-final.log` |
| `pnpm test:e2e --retries=0` | 45 passed；两库内容指纹未变 | `e2e.log` |
| `pnpm test:ui --retries=0` | 13 passed；两库内容指纹未变 | `ui-final.log` |
| `pnpm build`（由正式 E2E/UI webServer 启动链执行） | 生产构建成功并启动测试服务 | `e2e.log` / `ui-final.log` |
| `pnpm typecheck:scripts` | 通过 | `scripts.log` |
| `pnpm exec prisma validate` | 通过；check/build 同时执行 generate | `prisma-validate.log` |
| `pnpm audit --prod` / `pnpm audit` | 无已知漏洞 | `audit.log` / `audit-all.log` |
| `pnpm exec tsx scripts/cleanup-invitation-tokens.ts` | dry-run，候选 0 | `token-dry-run.log` |
| `python planning/package_plan.py bundle` / `python planning/validate_plan.py` | 生成阅读副本 / PASS | `plan.log` |

日志目录：`artifacts/m0-m4-fixes-20260911/`（被 Git 忽略）。必要回归已移入正式 tests，不依赖忽略目录里的临时探针。早期 `browser-targeted.log`、`escape-debug.log` 保留失败调查过程，最终准入按上表的最终命令判断。

## 边界与下一步

没有清空数据库，没有清理本轮开始前已有的 9 个历史 R1 项目，未进行 Git 提交或外部发布。工作区仍没有初始 Git 提交；这是交付可追溯性的后续事项，不将其冒充已解决的业务缺陷。

下一步按 `docs/06-IMPLEMENTATION-PLAN.md` 推进 **ORB-016 子任务清单 → ORB-017 评论 → ORB-018 私有附件与补偿 → ORB-019 工作台与时区**。沿用现有权限、事务、version 和活动边界。私有附件仍需真实 MinIO 联调。

M6 的部署、CI、性能、备份恢复、生产共享限流继续保留在原计划。当前测试证明列出的行为和回归通过，不宣称项目不存在任何未知缺陷。
