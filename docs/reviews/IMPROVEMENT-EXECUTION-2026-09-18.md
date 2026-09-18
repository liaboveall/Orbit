# Orbit 全面完善执行报告 · 2026-09-18

本报告是 [审查复核任务书](REVIEW-ANALYSIS-2026-09-18.md) OI-01—OI-30 的执行台账；逐项机器可校验状态以 [improvement-audit-2026-09-18.json](../../planning/improvement-audit-2026-09-18.json) 为准（由 planning/validate_plan.py 与 validate_plan_probes.py 强制校验，两者均已接入 CI）。

## 执行基线

- HEAD：`abe4149b19574485790df69bb19adcc65580d51a`（分支 `codex/m6-release`），工作区含用户未提交成果（48 个已跟踪修改 + 26 个未跟踪交付物，未提交）。
- 关键证据更正（OI-01）：`artifacts/audit-20260917/integration.log` 第 434—447 行记录 35 个测试文件、360 个用例通过，但全局隔离收尾抛出 "Development database contents changed during browser tests" 且命令以 exit 1 结束。同目录 `server.log` 显示同时段一个 `next start` 冒烟服务器在运行并发出认证邮件事件，与集成测试窗口重叠——外部写入干扰假设成立，根因判定为并行冒烟写库（无法绝对排除其他写入）。该轮运行不计为完整门禁通过。
- 执行入口：[prompts/AGENT-IMPROVEMENT-2026-09-18.md](../../prompts/AGENT-IMPROVEMENT-2026-09-18.md)。

## G6 本地门禁记录（2026-09-18，全部实际执行）

| 命令 | 退出码 | 结果 |
|---|---|---|
| pnpm lint | 0 | 通过（修复 1 处未用变量后复跑） |
| pnpm typecheck | 0 | 通过 |
| pnpm typecheck:scripts | 0 | 通过 |
| pnpm test:unit | 0 | 270 passed |
| pnpm test:contract | 0 | 173 passed |
| pnpm test:integration（受控串行） | 0 | 35 文件 / 360 passed，隔离收尾成功、两库指纹一致 |
| pnpm build | 0 | 生产构建通过 |
| pnpm test:e2e --retries=0 | 0 | 85 passed（零重试，含新增 IME 对话框用例） |
| pnpm test:ui --retries=0 | 0 | 13 passed |
| pnpm audit --prod --audit-level=high | 0 | 已知漏洞 0 |
| python planning/validate_plan.py | 0 | PASS（132 条审计条目、60 Markdown/184 链接） |
| python planning/validate_plan_probes.py | 0 | 11 个治理负面探针全部拒绝 + 阳性对照通过 |
| python planning/current_status.py --check | 0 | 摘要与 backlog 一致 |
| git diff --check | 0 | 无空白错误 |
| docker build（runner/operations） | 0/0 | sha256:bab185855223… / sha256:27f1cf5892c9… |
| node scripts/verify-nginx.mjs | 0 | secret 零泄漏、上游失败可见 |
| node scripts/container-smoke.mjs | 0 | ready/demo/非root/无env文件 |
| verify-backup.sh（离线容器） | 0 | 损坏检测/临时文件清理验证 |
| scripts/recovery-drill.ts | 0 | 隔离恢复内容校验通过 |
| trivy 0.69.3 两镜像 | 0（扫描完成） | 各 18 唯一 CVE，全部继承上游基座 |

日志：`artifacts/improvement-20260918/`（gate-*.log、trivy/、docker-*-build2.log）。注意：测试数量为实际输出（unit 270、contract 173、integration 360、E2E 85、UI 13），不与历史 884 对齐——新增治理探针/契约/单测并修复两处假绿测试。

## 阶段处置摘要

### G0/G1 治理与证据基线

- **OI-01 fixed**：撤销“884 全绿”当前声明；受控串行复验 360 用例通过、exit 0、指纹一致；runner 强化（真实退出码/信号/spawn 错误；“用例通过但 teardown 失败”受控复现判失败，--self-test 入 CI）。
- **OI-04/05 fixed**：validate_plan.py 重写——taskIds 非空/无重复/合法、双向关联、开放子项不被 closed 父项掩盖；任务/里程碑/应用状态白名单内置于校验器（独立于 backlog 可编辑数据）；里程碑 done 需全部任务 done；applicationStatus 枚举 + V1 完成语义门禁。11 个负面探针入 CI。
- **OI-06/07 fixed**：当前摘要唯一真源生成；runner 源清单补齐 planning/.github/Dockerfile/忽略规则；证据含 head/dirty/退出码/日志散列。
- final-audit 70 条回填 taskIds；OI-01—OI-30 正式注册表映射 ORB-020/021。

### G2 测试真实性与隔离

- **OI-08 fixed**：池恢复用例吞断言修复（失败路径 holder/pool 释放经 finally）。
- **OI-09 fixed**：60/min 用例重写（同一用户同一键、fake timers：60 允许/61 拒绝/窗口内拒绝/越窗恢复）。
- **OI-10 fixed**：定向排查无其他失能测试。
- **OI-11 fixed**：历史数据只读分类：18 用户全为 ui-* 合成夹具（Account/Session 缺失源于已披露 2026-09-13 调试误删）；9 个 R1 项目/9 条 ActivityLog 为合成夹具。未删除任何数据。

### G3 迁移、维护与 API 契约

- **OI-03 fixed**：两库 16 迁移零漂移（sha256 = 库内 checksum）；独立空库从零 deploy 成功、61 约束/52 索引与 orbit_dev 一致；migrate diff（迁移 vs schema）exit 0；第 16 个迁移完整入库交付。
- **OI-13 fixed**：/api/v1 catch-all JSON 404 信封（容器实测：既有路由不被抢占、匿名 401、嵌套未知路径 404）。
- **OI-14 fixed**：附件 content HEAD 405 协议语义（Allow、无 body、requestId）文档/契约/实现/E2E 四处一致。
- **OI-15 fixed**：query-binding 契约测试（40 参数绑定互验 + coercion/边界/枚举/required + operation→状态码→信封 + 内存变异）。
- **OI-16 fixed**：错误码测试运行时解析 docs/05 §3 真源（漂移变异被拒绝）。
- **OI-22 fixed**：维护入口守卫逐项实测（默认预览/非法参数/缺失 env/无 target/错 target 五种越界均拒绝）。
- **OI-23 fixed**：迁移 16 语义入 docs/04 §7；已应用迁移字节未改。

### G4 容器、部署与恢复

- **OI-12 blocked_external**：两镜像新扫描 18 唯一 CVE 全部继承 digest 锁定上游基座（基座对照扫描证实），我们的层零新增；全部无修复版本；trixie 实测 25 唯一 CVE 更多。等上游补丁；不自行豁免、门禁有效。
- **OI-17 fixed**：忽略规则精确修订 + 两镜像泄漏探针零命中。
- **OI-18 fixed**：生产编排真源关系明确并受测（仓库 compose = 外部 DB 场景；AWS 指南内联 compose = 同机场景，日志轮转 10m×3）。
- **OI-19 fixed**：container-smoke 参数化入 CI（真实启动/ready/demo/非 root/无构建 env）。
- **OI-20 fixed**：备份验证与恢复演练通过；生产 RPO/RTO 保持外部（productionRpoVerified:false）。
- **OI-21 fixed**：Nginx 合成 secret 泄漏探针 + 上游失败可见性两次验证通过。
- **OI-27 fixed**：Permissions-Policy 三处落地；HSTS/完整 CSP 维持受控分阶段决策。

### G5 用户体验

- **OI-24 fixed**：recent projects 路由切换不再重复请求；重叠刷新合并取消；换账号即失效。
- **OI-25 fixed**：Dialog 组合期 Escape E2E 回归补齐（合成事件限制注明）。
- **OI-26 fixed**：SIDEBAR_PROJECTS/CURRENT_USER 精确移除（消费者核对零引用）。
- **OI-28 deferred**：本地测量保留（千任务门禁 2.8s、bundle 14 路由零泄漏）；micro 1GiB 真云容量测量需 AWS 环境。
- **OI-29 fixed**：全量 E2E 85 + UI 13 真实浏览器回归确认视口/键盘/状态/IME；200% 缩放与真实 IME 实机走查维持既有限制。

## 逐项处置终态

| 状态 | 条目 |
|---|---|
| fixed（26） | OI-01, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29 |
| in_progress（1） | OI-02 — 仓库内修复完成、全量门禁通过；提交/推送/远端 CI 待会话授权 |
| blocked_external（2） | OI-12 — 上游镜像 CVE 无补丁（我们的层零新增）；OI-30 — V1 外部发布验收 |
| deferred（1） | OI-28 — micro 1GiB 真云容量测量 |

## 对原报告主张的处置结论

1. **集成退出 1**：确认。360 用例通过但 teardown 失败、exit 1；串行复验证明隔离机制本身正常，根因高度可能为并行冒烟写库。
2. **治理绕过**：确认并修复（复现探针→封堵→CI 强制）。
3. **两处假绿测试**：确认并修复（缺陷可被回归断言拒绝）。
4. **迁移漂移**：确认（两库 16 vs git 15），已入库交付并从零验证一致。
5. **镜像 CVE**：确认为上游继承、零新增、无修复版本——保持 blocked_external，不做 ignore-unfixed。
6. **未知 API 路径 HTML 404**：确认（原行为），已修复为 JSON 契约信封。
7. **未复现/保留设计**：Nginx error_log 关闭经泄漏探针验证为有效设计；trixie 基座实测更差不迁移。

## 剩余阻塞与所需条件

| 阻塞 | 需要什么 | 下一步 |
|---|---|---|
| OI-02 提交与远端 CI | 会话授权提交/推送 | 按完整依赖组创建内聚提交 → 推送 → 核对同 SHA 远端 CI |
| OI-12 镜像 CVE | Debian 12 补丁/上游重建 | 定期重扫；补丁发布后升级 digest 并复扫 |
| OI-28 真云容量 | AWS 环境（t3.micro/1GiB） | 按 docs/07 预算执行容量与备份重叠测量 |
| OI-30 V1 发布验收 | 部署 URL、HTTPS 双账户、SES/S3、每日调度、真云恢复演练 | 全部满足前 V1 保持未完成，M6 保持 review |
| 历史事故（18 用户） | 用户独立授权才可清理合成残留 | 不删除、不回填；AC-06 防误删守卫已验证 |

**完成口径声明**：本轮达到「仓库内修复已完成 + 本地全量门禁通过」；当前修订远端 CI、容器发布的真云验收与 V1 发布验收均未完成，不得混称。
