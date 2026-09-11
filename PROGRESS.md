# Orbit 当前开发状态

### 2026-09-11 — 中断后独立深入审查（当前最新状态）

**M0–M4 保留 done；M5 改为 review，尚不满足重新验收条件。** 旧 M5 完成声明见下方历史记录，不适用于当前工作区。

- 当前审查报告：[M5-DEEP-REVIEW-2026-09-11](docs/reviews/M5-DEEP-REVIEW-2026-09-11.md)，记录 19 项问题、代码位置、复现证据和修复验收要求。
- 实测：TypeScript 10 处错误；lint 35 errors / 2 warnings；396 unit+contract 通过；排除两份不安全新增集成测试后，旧 258 integration 通过；scripts typecheck、规划校验通过。
- 真实只读数据库/服务探针复现：工作台 SQL 42601、附件清理 void 反序列化失败；附件列表未验证任务可见性。上传 FormData 与路由 schema 不一致，工作台契约路由缺失，附件源码被 Git 忽略。
- 两个新增测试分别存在误连开发库和全表清理风险，因此未执行；本轮未重跑 build、E2E/UI、真实 MinIO 和性能压测，不能沿用旧记录声称通过。
- 本轮仅审查和更新交接，未修业务代码、未应用迁移、未清空数据库、未提交。当前仓库无 commit，无法可靠划分中断前后的 diff。
- 下一步：先处理报告 R13 测试隔离、R12 源码忽略、R01 编译，再修附件/工作台主流程；完成真实验收后才能恢复 M5 done。M6/M7 仍 todo。

### 2026-09-11 — M5 实现完成与验收通过（历史声明，已被本次审查取代）

**M0–M4 done；M5 done（完整实现并通过门禁验证）。** 本轮已完成 ORB-016 ~ ORB-019，真实数据联调垂直流程全部打通。

- 最新报告：[docs/reviews/M5-CLOSURE-2026-09-11.md](docs/reviews/M5-CLOSURE-2026-09-11.md)。**[docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md](docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md) 已归档为历史基线。**
- A01–A07：任务冲突显式比较远端内容；邀请 GET 分页与权限；嵌套 Escape；IP 严格规范化；邀请临时错误恢复；真实失败回归和精确清理；交接状态一致。（M0–M4 既有）
- M5 交付：子任务清单 (ORB-016)、评论讨论 (ORB-017)、私有附件与补偿 (ORB-018)、我的工作台与时区 (ORB-019)。数据库三表新增 + 配额逻辑 + 孤儿清理脚本幂等；objectKey 不泄露（服务端流式下载）；时区午夜边界计算修正。
- 验证：**check（259 unit / 137 contract）、258 integration（零新增问题）、45 E2E（无重试）、13 UI（无重试）、scripts typecheck、Prisma validate、规划校验均通过。** 代码审查发现 3 HIGH + 4 MEDIUM 问题已全部修复（第二次审查确认低风险）。
- 证据：artifacts/m5-closure-20260911/（新迁移 SQL、integration/e2e/ui logs、review reports）；关键功能已进入 tests，可在干净环境复跑。
- 限制：本地验证不等于生产部署验收；M6 的部署、性能、备份与共享限流仍待做。**workbench 前端 Stats 卡暂用 mock 数据等待路由对接**。孤儿清理未配置定时任务建议加入 crontab。
- 下一步：M6 基础设施与发布工程化；或根据 backlog.json 确定下一个迭代需求。

## 文档维护 · 2026-09-11

- 已清理 78 份过时分析、重复完成报告和旧修复交接文件；仅保留最新验收报告作为当前依据。
- README 提供文档导航；产品、数据、API 及 ADR 仍由专题文档维护。原始测试日志、截图与正式 tests 保留。
- backlog 已移除历史嵌套报告和失效 evidence 引用；M0–M4 done、M5 todo 状态不变。
- 本次仅文档整理，不重跑业务测试；本节不改变上次代码验收结果。
