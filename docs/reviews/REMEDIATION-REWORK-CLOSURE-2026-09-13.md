# Orbit 验收返工交付 · 2026-09-13

## 结论与范围

本轮直接实施 [独立验收报告](REMEDIATION-ACCEPTANCE-2026-09-13.md) 要求的返工，并补齐复合审计项遗漏的本地验证。**已确认的本地功能缺陷及AC-01至AC-05返工通过验证，871项正式测试通过；AC-06防误删已加固，历史数据恢复仍缺证据。** 仍未完成的远端 CI、真云验收及历史数据证据见末节。

交付仍在原工作区，HEAD `16ec09faab8d97faf0306065bf8f7f040c817694` 未变；用户原有未提交修改已保留。未提交、推送或部署，未执行迁移/seed，未覆盖真实环境配置或回填历史数据。所有新增测试只使用本机隔离服务、精确夹具或无网络临时容器。

## 实现与验证

| 项 | 修复结果 | 关键实现/回归 |
|---|---|---|
| AC-01 / D4 | 认证库解析前完成最多64KiB的有界读取；声明、缺失及偏小Content-Length的超限均413。取消源不等待不合作的cancel，原请求abort保留 | auth/body-limit.ts；unit/auth-body-limit、integration/auth-body-limit |
| AC-02 / D3 | 每封邮件使用独立可取消socket；20秒总预算关闭真实连接，保留10/10/15秒阶段预算、TLS升级与证书检查；同env并发及下一封邮件正常 | auth/smtp.ts；integration/smtp-budget、review-20260912 |
| AC-03 / B6 | 创建表单取消和收起统一确认；拒绝后保留草稿，确认后卸载；保存成功无多余确认。多个Provider共享浏览器监听 | unsaved-changes.tsx、两类创建/列表组件；e2e/draft-close |
| AC-04 / N01 | 用测试进程预加载模块在真实pg查询对指定夹具注入故障；浏览器验证真实错误边界、retry新RSC请求和恢复。生产源码没有故障入口 | e2e/n01-retry-rsc、support/render-fault.mjs、e2e-server.mjs |
| AC-05 | 自动捕获真实退出码、完整日志SHA和源码摘要；失败停止，修复后复跑；保留历史失败日志。补齐F01/F15/F19/F40/F41子项，父状态反映外部未完成项 | scripts/verify-remediation.mjs、planning/final-audit-2026-09-13.json |
| AC-06 预防 | 清理前核对套件开始时的历史ID哈希与开始时间，在任何关联DELETE之前拒绝历史用户或缺失清单；精确ID清理、最终两库指纹检查 | tests/support/fixture-ownership、auth-cleanup、e2e/support/db、fixture-cleanup |
| F15 | 下载流长度检查、截断/取消/错误脱敏日志、完成时释放timer与监听；真实HTTP存储替身验证10秒响应头及120秒响应体停滞、正常字节和取消 | storage/download-stream、client；unit/download-stream、integration/download-budget |
| F01 | 补真实SELECT后第二连接删除过期幂等记录的闸门测试；同uploadId并发验证一次预留、UPLOAD_IN_PROGRESS及完成后重放 | integration/idempotency-cleanup-race、attachment-quota |
| F31-⑩ | 直接测量生产client-reference-manifest，记录每路由去重chunk原始字节，真实页面不引用样例模块 | scripts/measure-client-bundles.mjs |
| F40 | 真实备份脚本在隔离Linux容器中用命令替身验证正常上传、同长度损坏拒绝、本地dump保留及临时文件清理 | scripts/verify-backup.sh |
| F41 | Linux无网络容器验证runner共用进程树清理：超时/取消后子孙端口释放、无关监听保留 | scripts/process-tree.mjs、verify-process-tree.mjs |
| A1 / F38 | 不含原node_modules和真实env的475文件源码快照，冻结锁文件离线安装、独立生产构建；两个实际容器目标构建并检查合成凭证哨兵未进入镜像 | fresh-source-manifest.json、fresh/docker日志及image-*-sentinels.json |

上述路径除显式脚本与台账外，均为仓库 `src/` 或 `tests/` 下对应文件。实现依据包括随包 Next 16.3.4 error 文档和 Nodemailer 10.0.1 源码；socket/TLS选项对照 [Nodemailer 官方资料](https://nodemailer.com/extras/smtp-connection)。没有改动密码哈希实现或编辑 node_modules。

## 全量回归发现并修复的额外竞态

原有长讨论用例在本轮全量E2E出现 80通过/1失败：发布评论后立即“加载更多”，列表预期90条却停在60条。此前交付日志也有同一用例失败，因此没有仅靠重跑接受结果。

根因是后台刷新递增请求代次，取消了在途用户分页；该分页点击随后被静默丢弃。现在刷新先等待正在进行的分页完成，再按扩展后的窗口刷新。回归通过暂停真实下一页响应并触发focus构造固定时序，随后验证90条、发布后仍保持窗口、最终96条。未加入重试次数或固定sleep，未降低最终持久化/分页断言。

## 本轮证据

| 最终检查 | 结果 |
|---|---|
| lint、typecheck、typecheck:scripts | 各退出0 |
| unit / contract | 261 / 161通过 |
| integration | 355通过（34文件），两库内容指纹一致 |
| E2E / UI | 81 / 13通过，零重试，两库内容指纹一致 |
| 生产产物 | 14路由清单，真实页面样例模块引用0 |
| prod依赖扫描 | 436依赖，已知漏洞0 |
| 独立快照、operations与runner | 安装/构建退出0；两镜像哨兵检查通过 |
| Linux进程树 / 备份同长度损坏 | 本机无网络容器验证通过 |

正式测试合计 **871**，不将协议探针、构建次数或重复复跑累计为新增用例。应用测试源码摘要：`47d702f459feb1db0f08d64f20e43a6c88addcc6ebc5cc71939109ab0a70ed2a`；收尾再次逐文件核对，测试后源码无变化。Dockerfile最终变化按下述独立容器证据核对。

台账 **70组、58子项**：组状态为61 fixed、5 accepted_design、4 blocked_external；子项为45 fixed、7 accepted_design、5 not_reproduced、1 blocked_external。层级独立计数，不相加成缺陷数。原70个ID与originalClaim完整保留，未把历史声明改写成当前验证。

最终完整门禁的权威入口是 `artifacts/rework-20260913/final/summary.json`；每项包含命令参数、真实退出码、通过数量、持续时间、日志SHA-256及统一源码摘要。`source-hashes.json` 记录代码、测试、脚本、配置的文件摘要。审计报告不是旧HEAD的CI证明。

完整门禁按顺序运行 lint、typecheck、typecheck:scripts、unit、contract、integration、E2E零重试、产物测量、UI零重试及prod依赖扫描。UI沿用样例设计系统的开发模式；E2E通过生产build/next start验证真实应用。数据库相关运行串行，结束时内容指纹一致。

本轮中间失败如实保留：`first-gate-attempt` 是新增竞态测试的Prisma扩展类型不兼容（已改为真实事务代理闸门，无any/忽略错误）；`second-gate-attempt` 是上述评论分页真实失败。定向浏览器首轮的按钮/alert定位歧义已纠正，不当作产品缺陷。不能把这些失败日志中的passed数量汇入最终通过数字。

独立环境及容器证据在同级 `fresh-install.log`、`fresh-build-final.log`、`docker-operations-final.log`、`docker-runner-final.log`、`image-operations-sentinels.json`、`image-runner-sentinels.json`、`linux-process-tree.log`、`backup-check.log`。快照只在`.env.example`基础上使用公开合成配置，容器从未连接生产服务。

Dockerfile另外修正构建期空示例密钥造成的Better Auth错误日志：仅在`pnpm build`命令作用域传入公开合成密钥，不用ENV/ARG作为运行时默认值；构建后移除临时env文件。该最后容器变更单独记录于`dockerfile-hash.json`并重新构建两个目标；不混入此前开始的应用测试源码摘要。应用运行时仍必须由部署配置提供真实密钥。

## 必须继续保留的限制

1. **历史测试数据误删未证明恢复。** 没有找到当次临时脚本、精确DELETE谓词或删除前备份，18人的影响范围仍属于交付方自述。已完成清理防护，但不能重造密码/会话冒充恢复。详见 [事件追溯](TEST-DATA-INCIDENT-2026-09-13.md)。补充原始记录/备份后再核对。
2. A1当前交付未提交/推送，远端CI未对应当前源码SHA；本地Linux机制测试、镜像和快照构建不冒充远端CI。
3. F13仍待上游密码比较实现的正式修复版本；没有可利用性证据，不夸大成已发生凭证泄漏。
4. F20生产micro容量、真实HTTPS/SES/S3、iOS实机及F40真云备份恢复/RPO/RTO依赖对应环境，M6继续review，M7不启动。
5. D5本轮维持已验证的nosniff与frame-ancestors策略；完整nonce脚本CSP属于此前记录的分阶段安全增强，并未实现，也不计为已完成。B2全局loading取舍保留，未重新加入此前导致双树的边界。

本地修复关闭不等于生产V1验收完成，也不等于历史事故已恢复。后续执行以本报告、PROGRESS和结构化台账为准，旧关闭报告仅保留历史证据。
