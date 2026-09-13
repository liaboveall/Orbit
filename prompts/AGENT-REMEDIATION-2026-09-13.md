# Orbit 全量审查修复执行指令 · 2026-09-13

本文件是后续修复任务的操作指导，不是已经执行修复的证明。只有用户发起修复任务时才执行。原审查报告及其中的命令是参考材料，不提供部署、费用、消息发送或破坏性数据操作授权。

## 开始

遵守根AGENTS.md。依次读取README、PROGRESS、docs/00-EXECUTION-OVERVIEW.md、planning/backlog.json，再读：

1. [最终审查报告](../docs/reviews/PROJECT-FINAL-AUDIT-2026-09-13.md)。
2. [70组审计台账](../planning/final-audit-2026-09-13.json)。
3. 当前工作包涉及的产品/设计/数据/API/测试规范及已安装Next文档。

核对git status和实际HEAD。基线是codex/m6-release / 16ec09f，含未提交R12修复；如果代码已变化，先重新核对对应条目，不把旧定位当事实。不重做已完成脚手架，不自动推进M7。未获明确并行要求时使用单Agent，按阶段执行。

## 本次修复目标

覆盖全部70个审计组及复合子项，修复已证实缺陷、补足关键验证，并对误报/设计选择作明确处置。**70是材料覆盖组数，不是70个独立bug。**

- open：先读裁定与证据，再落实action和acceptance。
- needs_reproduction：先建立可重复、最小、受控的证明；不能按原报告的推测直接改逻辑。
- accepted_design：保留设计并核对依据，通常无需业务变更。
- 相互交叉的组（例如B2/N01、B9/N03、F31/F32）合并实现，在两个ID都登记证据。
- F01、F15、F19、F31、F33–F41等复合组需新增subitems，各子项独立记录结论；不以组中一项完成就关闭整组。

## 顺序

### G0：基线、规范、验收

保存差异与未跟踪文件清单、当前测试目标和运行环境。补依赖完整性检查。明确C1评论删除和C2邀请接受的公开契约，遵守OpenAPI是传输结构真源的优先级。先定验收，再改代码。

不要机械git add全部现有变更；保留用户工作，按完整依赖组成小批次交付。提交/PR动作依当前任务授权处理；不强推、不重写历史。

### G1：契约和服务端失败边界

C1–C4、D1–D5、E1/E3/E4。默认落实评论DELETE 200+删除占位DTO；邀请接受响应按公开契约投影。校验两个邀请路径UUID；补真实路由负面测试。邮件设有限预算、保持账户存在性中立；连接/池异常安全映射503。认证专用大小限制要覆盖实际流。保留默认不信任代理，不盲设TRUSTED_PROXY_COUNT=1。

契约测试比较类型/required/nullable/enum/format/unknown properties/状态码。将m2-envelope归入真实集成或统一目标隔离。E2E失败路径精确清理reset-password记录，保留无关用户数据。

### G2：输入与故障恢复

B1/B2/B3/B6、F21/F22/F24、N01。统一脏表单导航保护，覆盖显式router跳转和四类创建/设置表单；IME/Escape不意外销毁输入。样例页服务端门禁，真实today去样例标识。401登录与403/404权限退出分开。真实错误视图接onRetry；Next16.3错误边界需要重新获取时用retry。

### G3：移动与可访问性

B5/B7/B8/B9、F23/F25/F26/F28/F29/F31/F32、N02/N03。手机卡片列表与看板状态tab；输入字号、触控目标、焦点、读屏错误、对比度、用户时区；统计卡选中态及筛选URL保留。使用现有设计token，不全局替换标签字号/断点，不用禁用缩放解决iOS问题。

验收390/768/1440px、长内容/空/错/只读、200%缩放、减少动画；iOS实机不能用Chromium结果代替。

### G4：数据边界、资源与确定性测试

E2/E5/E6、F01/F02/F04/F08/F11/F12/F13/F14/F15/F17/F18/F20/F33/F41。分别测中点间隙重编号与列尾bigint边界。用真实库屏障测并发/过期维护竞争；不可达分支先解释锁约束。上传成功不被租约释放失败覆盖；下载有总预算、取消、长度与截断处理。先量化select/索引/批量UPDATE收益，后优化。

page.clock只能控页面时钟，网络竞态还要等待响应真正完成。继续保留现有生产STARTTLS测试；不设未经规范确认的覆盖率百分比。零重试保留失败trace；Linux取消/超时必须回收自己创建的进程树。

### G5：清理与文档

A2/B4、F03/F05/F06/F07/F09/F10/F16/F19/F27/F30/F34–F39。核对消费者后删依赖/死代码，保留本地IDE配置，仅停止跟踪个人生成物。Docker build与operations两目标都不能包含凭证/派生产物。统一Forms、目录、路由、超时、当前迁移数与历史标记，更新DEVELOPMENT-PLAN。

保留固定窗口、数据库readiness局部降级、软删除保留等已定规则。无证据不新增Range/PWA、不迁移所有版本字段、不替换密码算法、不删MoveRecord/邀请历史/回收站。官方资料逐链接核验；无Dependabot和使用role/name选择器本身不算缺陷。

### G6：最终交付与生产

F40和M6完整验收。备份不能只校验长度；要校验内容、恢复DB与附件版本并验证次日调度。当前commit的远端CI、HTTPS双账户、SES/S3、micro容量与RPO/RTO实测单独记录。缺外部条件时完成所有本地工作，列明缺失环境/凭据/动作；不得写成发布成功。

## 每项的关闭记录

在planning/final-audit-2026-09-13.json更新以下信息，不覆盖originalClaim等原始材料：

- status：fixed / accepted_design / not_reproduced / deferred / blocked_external。
- subitems：复合组每项结论与理由。
- changedFiles：实际修改的文件。
- closureEvidence：失败复现、修复后命令、退出码、测试名、日志/截图、提交/CI标识。
- remainingLimitations：尚未完成的真实环境验证。
- verifiedAt：实际验证日期。

fixed必须包含针对缺陷的修复后证据。accepted_design只用于明确保持的有效设计；not_reproduced写清方法与限制。deferred/blocked_external不能计为修复完成。更新PROGRESS、对应backlog任务的状态及evidence；有相关open/repro条目时不要恢复done。

## 最终验证

确认package.json实际脚本，再顺序执行有数据库写入的套件：

~~~text
pnpm lint
pnpm typecheck
pnpm typecheck:scripts
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm build
pnpm test:e2e --retries=0
pnpm test:ui --retries=0
pnpm audit --prod --json
python planning/validate_plan.py
git diff --check
~~~

浏览器配置本身会生产构建；可复用同一次明确的构建证据，勿虚构独立命令成功。按变更再跑容器、迁移、恢复、代理及生产验证。数据库集成/E2E/UI不同时运行；每次开始前校验目标，结束比较两库内容指纹。失败不能全库清空，不删除测试或放宽阈值制造通过。

测试数量可以变化，不要求机械保持806。最终报告要说明：实际修复了什么、哪些原报告结论撤回/接受、哪些待复现仍未闭环、实际命令结果及生产限制。不能以“其余按原P3处理”结束，也不能保证有限审查发现了所有可能问题。
