# 当前实现与交付边界

产品、架构、数据和接口规则分别维护在专题规格中；任务状态见 [backlog](../planning/backlog.json)，开放状态以 [开放清单](../planning/open-items.json) 为准。两轮审查的问题、修复与验收证据见 [当前审查](CURRENT-REVIEW.md)。旧开发日志、历轮报告和已关闭审计项使用 Git 历史追溯。

## 已实现

M0—M5 已完成：认证与账户设置、项目与邀请、任务列表与看板、成员与动态、子任务/评论/私有附件、个人工作台。包含权限和资源归属校验、事务与并发控制、幂等、草稿保护、失败恢复及附件补偿维护。

最近修复覆盖创建草稿收起、默认优先级、筛选保留、配额提示、staging 代理配置、登出确认次序、成员退出计数和真实看板协作计数；另有看板统计合批、附件进程并发/临时磁盘保护、统一接口校验及真实数据库写入失败回滚回归。

2026-09-24 修复两轮审查确认的 10 个应用问题：任务草稿生命周期（退出/换账号/失去项目访问清理、确认放弃即删除、恢复时字段可见）、无 Navigation API 的后退保护、任务在别处删除后页面与草稿保留、看板筛选集合跨页一致性、服务端页面共用读取额度、认证邮件响应后投递（消除失败状态与耗时差异）、连接池饱和映射 503、上传超时/中断/依赖故障分类；并处理文档冲突、可访问性标题层级、附件文件名方向控制字符、过期认证记录清理与邀请令牌暂存期限。

2026-10-19 全量深度审查与全面优化：启用服务端 `ipv4first` DNS 顺序以消除本机 IPv6 回退延迟；修复邀请预览页用户时区与已登录态注入、登录/注册页已认证重定向 `returnTo` 保留、非 owner 访问项目邀请页的权限只读态、任务列表与工作台游标/筛选异常提示；统一各领域服务的 UUID 大小写归一化与成员稳定排序；补齐移动端 16px 输入规范、子任务/评论 `Escape` 放弃草稿确认、编辑器与看板 401/404 处理、移动端面板关闭焦点恢复、恢复按钮幂等键轮换及密码超长提示；将 `next`/`eslint-config-next` 升至 `16.3.8`、`nodemailer` 升至 `10.0.16` 并通过 `pnpm.overrides` 修复全部新披露传递依赖漏洞。

## 验证

2026-09-24 在冻结工作区（随后提交为 `5730d69`）上运行完整门禁（scripts/verify-remediation.mjs，PASS，运行前后源码指纹一致）：297 unit、172 contract、380 integration、102 E2E、13 UI，共 **964 项通过**；浏览器零重试，真实开发/测试库前后指纹一致；恢复演练与依赖审计通过。实际结果及证据摘要见 [verification](../planning/verification.json)。

2026-09-24 依赖更新：react、react-dom、@types/react、@types/react-dom 一起升到 19.3.0，取代只升了 react 与 @types/react 而单元测试失败的 Dependabot #9；并为 React、Prisma、Tailwind 三组必须同版本的依赖加 Dependabot 分组。在基于 `2229ed1` 的冻结工作区上完整门禁 PASS（964 项，指纹一致），之后只加了分组配置与本条记录，见 verification 的 dependencyUpdates。

2026-09-25 依赖更新：合并处理 10 个 Dependabot 提案（#3—#8、#10—#12、#14）。npm：typescript 6.0.3（typescript-eslint 的 peer 限制在 6.0 系列）、@types/node 26.6.2、lucide-react 1.47.0、@axe-core/playwright 4.13.0、tailwind-merge 3.7.0；CI Action：checkout v7.0.1、setup-node v7.0.0、upload-artifact v7.0.1、pnpm/action-setup v4.3.0、trivy-action v0.36.0（不在 GHSA-69fq-xp46-6x23 影响范围内），每个提交号都经 API 核对为官方标签所指提交。在基于 `c4eaa7e` 的冻结工作区上完整门禁 PASS（964 项，指纹一致），之后只加了本条记录；Action 变更只由远端 CI 覆盖。随后 Dependabot #7 将 pnpm/action-setup 升到支持 Node 24 的 v6.1.0，CI 已无 Node 20 弃用提示。

2026-09-26 部署准备（ADR-030）：目标改为 Oracle Cloud Ampere A1 单机（2 OCPU/12 GB，ARM64），见 [OCI 部署指南](OCI-DEPLOYMENT.md)。Next 升到 16.3.6（官方安全修复 GHSA-vcvr-r3jv-pc5j，`next/og`，本项目未使用）；linux/arm64 镜像模拟构建后 runner 冒烟与 operations 迁移状态均通过；新增同机 SeaweedFS 配置、`infra/backup-local.sh`（在断网容器自测失败路径，并用真实 PostgreSQL/SeaweedFS 完成备份与恢复演练）和 `scripts/storage-check.ts`。证据见 verification 的 ociDeploymentPreparation。

2026-10-19 全量深度审查与依赖安全修复后，在冻结工作区上运行 `scripts/verify-remediation.mjs`（输出目录 `artifacts/rework-2026-10-19T10-22-33-368Z`，**PASS**，运行前后源码指纹 `680f0b72...` 一致）：304 unit、172 contract、380 integration、102 E2E、13 UI，共 **971 项通过**；浏览器零重试，生产依赖安全审计 0 漏洞，见 verification 的 comprehensiveAuditAndOptimization20261019。

2026-09-22 首轮审查的 925 项基线门禁与 5 个 P2 观察保留在 verification 的 previousAudit 中；本轮新增回归覆盖全部 10 个问题，其中浏览器、看板筛选、认证邮件与上传分类回归已在原实现上确认失败。

测试按现有行为维护，不按编写日期删除：带日期的套件已改为功能名；首页冒烟并入公开入口套件，保留原断言。构建、类型、契约、隔离、维护与恢复检查仍用于本地和 CI。

## 发布与历史边界

- M6 保持 review，V1 尚未发布。服务器已开通（Oracle ARM），用户按 OCI 指南自行执行；第一阶段无域名与邮件，邮件验证/重置、邀请协作、告警与异地备份仍待验收；M7/AI 尚未开始。
- 基线 SHA 的 [完整 CI 成功](https://github.com/liaboveall/Orbit/actions/runs/35671586439)；修复提交 `5730d69` 的[完整 CI 成功](https://github.com/liaboveall/Orbit/actions/runs/35953986961)，受测代码树一致。正式发布仍须绑定实际交付提交与不可变镜像；服务器仍需 HTTPS 双账户、邮件/存储、资源预算、告警、定时维护和备份恢复验证。
- 其后只更新记录的 `198ec23` 的 [CI 失败](https://github.com/liaboveall/Orbit/actions/runs/35968230138)在 nginx 校验脚本：容器入口尚未启动 nginx 时脚本就发出请求（启动竞态；其余已执行步骤均通过）。本机以延迟启动镜像复现了同一错误，脚本已改为先有上限地等待就绪。
- 2026-09-24 起 Quay 上的 MinIO 仓库要求登录，CI 在启动服务时失败（[运行 36035562583](https://github.com/liaboveall/Orbit/actions/runs/36035562583)）；MinIO 社区版已归档、Docker Hub 镜像已下架。已把原锁定镜像逐层原样推到私有 `ghcr.io/liaboveall/orbit-minio`（镜像层与启动命令一致，冒烟与版本号核对通过），CI 以只读包权限登录拉取（ADR-028）。2026-09-25 再次匿名核对仍无法拉取，本地与 CI 已改用 SeaweedFS 4.47（ADR-029），不再需要私有镜像与 GHCR 登录；候选对比与验证证据见 verification 的 storageReplacement。
- 实机输入法、原生缩放和辅助技术验证不能由自动化浏览器结果代替。
- 开发库迁移 `20260911031124_add_subtask_comment_attachment` 与 `20260911031200_add_m5_check_constraints` 的历史 checksum 不符；后者记录为 `manual_resolve`。2026-09-24 只读复查结果未变：测试库正常、两库结构一致。原始迁移字节仍未找回，未改写数据库历史。
- 先前数据事件缺少原始记录和备份，无法宣称已经恢复；当前测试具有独立数据库、夹具所有权和前后指纹保护。
- 已知旧临时目录中的 66 份配置文件经只读核查均不存在，清理来源未知，不再作为开放待办。

上次仓库清理的文件变更与受阻删除记录保留在 Git 历史；本轮验证日志保存在忽略的本地产物目录 artifacts/remediation-20260924，摘要与哈希记入 verification。

## 维护资料与迁移的保留规则

当前只保留有效规格、运行手册、开放事项和最新验证摘要。历史分析、报告、快照清单、一次性修复指令及已停用脚本不作为新的操作入口。

`prisma/migrations/` 中的 16 份 SQL 都是当前迁移链的一部分，新库建库和已有数据库升级仍依赖它们。此次清理不改变其内容、编号或数据库 `_prisma_migrations`。即使迁移中的历史注释提到已删除报告，也不修改已应用文件的字节；该报告可从 Git 历史检索。将来如需合并迁移，须先设计新旧数据库的基线切换和备份恢复流程。
