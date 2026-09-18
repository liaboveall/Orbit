# 综合审查修复与验收

基线：abe4149。输入报告为 COMPREHENSIVE-REVIEW-2026-09-13.md；其中建议是待核实材料，不覆盖产品、数据和安全规范。逐项状态与证据保存在 planning/comprehensive-audit-2026-09-13.json，并由 backlog 关联。

## 实施范围与验收

1. 维护入口统一默认只读预览；执行需明确 APP_ENV、目标指纹和 --execute。指纹绑定数据库主机/端口/库/schema及附件存储端点/桶；错误目标在连接数据库前拒绝。开发/测试只允许本机开发或测试资源；生产维护保持可显式执行。日志不包含凭证、连接串或对象 key。补充只读配额对账，不自动改账或删除用户。
2. 代理认证限流和业务连接预算，保留脱敏访问日志；补充上游状态/耗时。不得重新启用包含令牌的原始错误日志。用真实 Nginx 验证配置、限流及合成秘密不入日志。
3. 审计项唯一 ID、结论、证据、剩余限制关联任务；done 不允许关联未关闭项。当前摘要自动从 backlog 生成，历史日志保留。校验器仅遍历正式规划输入，不扫描 artifacts/node_modules。
4. 真实侧栏读取当前用户参与的最近六个未归档项目，跳转真实看板；无项目、加载失败、权限变更、长名称、移动抽屉和换账号均有确定行为。公开演示明确固定日期快照，不改动真实截止日计算。
5. 手机看板 tab/panel 关联、单一 tab 停靠点、方向键/Home/End；桌面三列仍有正确语义。IME 组合 Enter/Escape 不保存或关闭，嵌套弹层只处理顶层 Escape。
6. 合并排序重编号逻辑、规范 UUID；统一删除参数校验与追踪 ID；健康探针查询移至服务层。保持 HTTP 契约不变。
7. 邀请外键与 CHECK 一致，移除冗余 CHECK；仅新增迁移，不改已部署迁移。真实测试库验证约束，数据指纹不变。
8. 池大小可配置并有边界；本地真实数据库测量排序/并发，不凭推测添加索引或扩大池。生产 micro 内存与 RPO/RTO 仍需目标环境测量，记录限制与可复现实测步骤。
9. 镜像漏洞扫描、Action SHA 固定、依赖策略、升级/领域开发清单落地。扫描失败不能静默跳过。

## 复核原则

- 2.3 已有真实 handler+状态码+Schema 集成测试；按行为覆盖补盲点，不重复造测试目录。
- 2.4 已有 failUpload 即时补偿；验证补偿失败后的持久兜底，不在数据库事务中调用 S3。
- 2.5 成员退出不 bump boardVersion 是明确规范；验证刷新与任务版本，不改变语义。
- 3.3 同列末尾 no-op 已实现并有回归；保留。
- 3.13 两次迁移分别针对开发/测试库，保留并明确命名。
- 历史测试数据事故缺原始记录和删除前备份，不能因本轮通过标作恢复；M6 外部验收与 M7 边界保持。

## 本轮结果

32 项全部逐项核实：22 项修复、7 项按已定规范保留、1 项基线已实现而未复现、2 项外部阻塞。详见 [逐项台账](../../planning/comprehensive-audit-2026-09-13.json)。不能宣称“全部问题解决”或“可发布”。

主要交付为维护目标守卫、当前状态生成与审计校验、代理限流及安全日志、真实侧栏、移动看板无障碍、IME保护、统一版本参数与追踪、排序重编号复用、邀请约束迁移和镜像扫描门禁。额外补齐客户端 void/204 支持，并修复真实任务详情三个子列表的重复 React key。

### 实际验收

证据目录：`artifacts/comprehensive-20260913/`（本地忽略目录，完整日志不默认纳入仓库）。

| 命令/检查 | 结果 | 证据 |
|---|---|---|
| pnpm check | exit 0；lint、typecheck、265 unit、162 contract | check-final.log |
| pnpm typecheck:scripts | exit 0 | final/scripts.log |
| pnpm test:integration | exit 0；35文件360测试 | final/integration.log |
| pnpm test:e2e --retries=0 | exit 0；生产构建84测试 | final/e2e.log |
| pnpm test:ui --retries=0 | exit 0；13测试 | ui-verified.log |
| pnpm test:e2e tests/e2e/m5-regressions.spec.ts tests/e2e/comprehensive-review.spec.ts --retries=0 | 最后React key调整后exit 0；9测试 | e2e-final-targeted.log |
| python planning/validate_plan.py / current_status.py --check | 均exit 0；4种无效审计状态均被拒绝 | planning/VALIDATION.md、planning-negative-probes.json |
| node scripts/measure-client-bundles.mjs | exit 0 | final/bundles.log |
| pnpm audit --prod --json / pnpm audit --json | 均exit 0、各级漏洞0 | audit-prod.json / audit-all.json |
| 迁移 dev/test | 各16迁移；新增约束迁移成功，业务内容指纹不变 | migration-summary.json、migration-orbit_dev.log、migration-orbit_test.log |
| pnpm maintenance:cleanup | 默认只读；99条过期幂等候选，17项目配额0差异；未执行清理 | maintenance-preview.log |
| node scripts/verify-nginx.mjs | exit 0；60认证请求中11接受49拒绝；健康可达，上游503可见；秘密不入日志 | nginx/summary.json、access.jsonl |
| docker build runner / operations | 两个目标构建成功；非root运维CLI与缺环境拒绝检查通过 | docker-*-final.log、operations-cli.log、operations-preflight.log |
| Trivy 0.69.3 HIGH/CRITICAL（两镜像） | 均exit 1；各56条系统包记录，Node依赖0 | trivy-*-final.json |

正式套件总计884项；最后9项是重跑，不重复计数。初次UI的3个失败来自旧测试仍要求六个样例项目，已改为当前用户真实项目及键盘导航断言；修复后13项通过。UI日志暴露的React重复key也已修复并有无重复key断言。

集成/E2E/UI均串行使用独立测试库和精确夹具清理，前后开发库、测试库业务内容指纹一致；未删除用户原始文件或清空数据库。全量回归源码指纹保存在 `final/source-hashes.json`；其后的改动为UI断言、详情子列表key、注释/空白、镜像与CI、文档台账，并已按影响补跑检查。初次完整runner因UI失败停止的原始summary保留，不改写成全绿。

### 测量与保留设计

默认5连接、1000任务合成项目、10并发、每排序30个样本：updated_desc p95 53.54ms、due_asc 43.77ms、priority_desc 42.81ms，错误0。EXPLAIN使用projectId索引后对项目内少量行排序。这不足以证明需要加大连接池或追加索引，也不是1GiB真机验收。

成员移除不增加boardVersion、同列末尾移动no-op、双数据库迁移、预留错误码、V1不提供自助注销均按现有规范处理。演示固定日期改为可见快照说明。样例与真实TaskCard分属不同交互，命名区分而非强制合并。原始Nginx error_log不能套用访问日志脱敏格式，继续禁用并增强安全访问日志的状态/耗时诊断。

### 明确剩余项与下一步

1. **CR-2.2：真云1GiB内存与连接预算。** 缺实际部署主机及测量证据。按 [升级及性能清单](../14-CHANGE-AND-UPGRADE-CHECKLIST.md) 采集web、数据库、维护/备份重叠时峰值，再设置容器和PostgreSQL预算；不凭本机数据臆设生产限制。
2. **CR-2.9：镜像系统包漏洞。** 扫描门禁已实现，PCRE2可用补丁已安装，未使用npm及运维Corepack/pnpm已从最终阶段移除。两镜像仍各52 HIGH/4 CRITICAL、共18个唯一CVE，扫描库均无FixedVersion；涉及util-linux、perl、gzip、acl、systemd、ncurses、zlib。未使用ignore-unfixed、豁免或continue-on-error隐藏结果。需上游修复，或另行验证替代基础镜像/最小运行层后重扫；当前镜像不可按本项目门禁发布。系统包记录不等于每项均可从Web利用，但无足够证据自动豁免。
3. **既有外部验收**：当前修订远端CI、HTTPS双账户、SES/S3、生产调度与恢复RPO/RTO仍未验证。历史18用户事故缺原始记录/删除前备份，本轮指纹一致不能追溯证明恢复。

镜像扫描工具使用固定digest `aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c`。PCRE2补丁依据 [Debian安全跟踪](https://security-tracker.debian.org/tracker/CVE-2026-86145)。本轮没有推送、部署或生产维护执行；M6保持review，M7未启动。

最终镜像基于 `delivery-source-hashes.json` 中485个输入构建（不含运行环境文件）；其后仅更新了规划校验和交付记录。两份最终镜像扫描依旧exit 1，结果未覆盖成绿色。
