# M5 全量修复关闭报告 · 2026-09-11

当前结论：**深入审查 R01–R19 已修复并完成本地重新验收，M5 恢复 done。M0–M4 保持 done；M6/M7 仍 todo。** 本报告取代旧 M5-CLOSURE 的完成声明；原 DEEP-REVIEW 保留为问题基线。

## 修复与验收对应

| 问题 | 已完成修改 | 正式回归证据 |
|---|---|---|
| R01 编译与 lint | 修复未定义符号、错误 DTO、SQL 类型与不安全测试；严格 TypeScript 与 lint 无错误 | pnpm check、typecheck:scripts、build |
| R02 附件授权 | 列表先验证父任务、项目成员及任务未删除；非成员与不存在均 404 | attachment-quota、m5-regressions |
| R03 上传链路 | 按 uploadId/declaredSizeBytes/sha256/file 解析 multipart；文件类型、大小、SHA 逐流验证，DTO 严格映射 | 实际中文文件上传、MinIO 字节比对、移动端浏览器 |
| R04 传输契约 | 附件列表返回 Attachment DTO；download 返回 JSON 签名应用链接，content 流式二进制；DELETE 返回 204 并保留 no-store/request-id | 严格契约解析、浏览器下载和 DELETE 状态断言 |
| R05 删除与父任务状态 | 项目行锁内复核归属、成员、归档、父任务及附件状态；额度只扣一次；下载每次重验会话与权限 | 并发删除、归档、移除成员、删任务、过期/跨用户签名测试 |
| R06 上传一致性 | 预留与 READY 独立事务；临时文件/S3 I/O 在事务外；最终复核权限；失败保留可追踪记录 | 阻塞实际 PUT 同时更新项目/移除成员；失败后补偿 |
| R07 清理与重试 | 有界候选、项目锁内状态重查、独立 S3 DELETE、失败标志保留；取消 PUT 的待删状态等待 3 分钟；CLI 可运行 | 并发清理、删除失败重试、上传中删除；空库实际运行 cleanup:attachments |
| R08 输入与配额 | 请求 10 MiB+64 KiB 上限、文件 10 MiB、字段/部件限制、120 秒超时、实际大小/SHA/MIME/签名或 UTF-8 校验；used+reserved 共同占额 | 畸形 HTTP、错序字段、伪装格式、摘要/大小不匹配、取消、5 文件并发上限、项目预留配额 |
| R09 工作台计算 | 参数化真实 PostgreSQL 聚合、正确别名和 bigint 转换；totalOpen 独立计数，统一可注入时刻 | 重叠桶、不重复总数、时区/DST、成员/归档/软删除过滤 |
| R10 工作台接线 | /my/overview、/my/tasks 与 /app/today 使用真实数据；六类任务、搜索排序、游标分页及加载/空/错误状态 | 双用户过滤、三种排序完整分页、浏览器从详情进入真实工作台 |
| R11 迁移一致性 | uploadId 保持 UUID；移出无效 varchar 草案；Prisma 显式复合关系；第 11 个迁移仅移除冗余单列 FK | 开发/测试库各 11 迁移，空库重建，migrate diff 零差异，复合外键拒绝跨项目写 |
| R12 源码交付 | 忽略规则锚定根数据目录，附件源代码、组件和路由不再被忽略 | git check-ignore 对三个源码层均未命中；frozen-lockfile 安装通过 |
| R13 测试隔离 | 测试库强校验、精确 UUID 夹具、禁止全表清理；浏览器清理覆盖子资源与私有对象 | 完整集成及浏览器前后开发/测试库内容指纹一致 |
| R14 上传幂等 | 比较文件名/MIME/大小/摘要；对象路径使用全局 attachment UUID；重放不重复占额或活动 | 同键重放、异内容冲突、不同上传者同键、并发预留 |
| R15 权限菜单 | 显式传入 OWNER 身份；普通成员可改清单，任务创建者不能因此删除他人评论/附件；附件删除增加写限流 | 成员任务创建者浏览器验收、作者/所有者权限矩阵 |
| R16 写入重试 | 同一未确认正文沿用 Idempotency-Key；服务端统一 UUID 校验；成功后才换键 | 真正落库后中断响应、再次提交仅一条评论；子任务/评论并发同键 |
| R17 刷新与分页 | 子资源随 revision/focus/定时刷新且保留草稿；忽略晚到响应；评论维持已加载页、稳定去重；修正 HTTP 列表信封 | 35→36 评论分页、保留草稿、晚到子任务响应、删除占位 |
| R18 聚合性能 | 每批子任务/评论/附件分别 groupBy，替代逐任务 count | 千任务真实 PostgreSQL：概览 2 查询，100 条列表≤8，看板 24 查询 |
| R19 活动 | READY 和删除状态在同事务写 FILE_UPLOADED/FILE_DELETED、同步父任务 updatedAt | 活动条数、成功/失败/重放与配额一致性 |

关键入口：`src/server/modules/attachments/`、`src/server/modules/workbench/service.ts`、`src/server/modules/task/mappers.ts`、`src/features/tasks/{subtasks,comments,attachments}/`、`src/app/app/today/`、`src/app/api/v1/my/`。

本轮验收另外修复了评论分页 HTTP 信封、附件 DELETE 状态/限流、缺失浏览器 MIME、上传前取消挂起、拒绝文件流的错误监听、晚到刷新覆盖和 Prisma 复合外键遗漏。未通过屏蔽测试、忽略 TypeScript 错误或放宽服务端授权使测试通过。

## 实际执行证据

路径均相对仓库根，原始日志在本机 artifacts，正式测试纳入源码。

| 命令/操作 | 实际结果 | 日志 |
|---|---|---|
| pnpm install --frozen-lockfile | 锁文件一致，无解析变更 | m5-frozen-install.log |
| pnpm check | lint/typecheck 通过；262 unit、137 contract 通过 | m5-final-check.log |
| pnpm build | 生产构建通过，包含全部 M5 路由 | m5-final-build.log |
| pnpm typecheck:scripts | 通过 | m5-final-scripts.log |
| pnpm test:integration | 22 文件、297 项通过，无未处理错误 | m5-final-integration.log |
| 完整集成前后数据库指纹 | 开发库/测试库均恢复到运行前内容 | m5-integration-isolation.log |
| E2E_PORT=43127 pnpm test:e2e | 完整套件 49 项通过、零重试 | m5-full-e2e.log |
| E2E_PORT=43127 pnpm test:e2e -- tests/e2e/m5-regressions.spec.ts | 最终修改后 6 项通过（含后来新增的 2 项），零重试 | m5-final-m5-e2e.log |
| E2E_PORT=43127 pnpm test:ui | 13 项通过、零重试 | m5-final-ui.log |
| 浏览器隔离门禁 | 上述各轮开发库/测试库内容指纹一致 | 对应浏览器日志末尾 isolation |
| pnpm exec prisma validate | 通过 | m5-prisma-validate.log |
| Prisma migrate deploy + diff | 全新隔离库 11 迁移，模型零差异；精确清理临时库 | m5-migrations-fresh.log |
| 开发/测试库 migrate deploy | 各 11 迁移；两库业务数据指纹不变 | m5-migrations-deploy.log |
| cleanup:attachments 入口 | 在全新隔离库实际运行，退出成功 | m5-migrations-fresh.log |
| 千任务查询定向采样 | 10 次：中位约 9.96ms，最慢约 37.27ms，看板 24 查询 | m5-performance-evidence.log |
| python planning/package_plan.py bundle / python planning/validate_plan.py | 阅读副本更新；115 Markdown、63 本地链接、37 操作、25 任务校验通过 | m5-plan-final.log |
| pnpm audit --json | 0 已知漏洞 | m5-dependency-audit.json |

千任务采样是本机顺序回归，不能当成生产负载或并发 P95 承诺。定向性能命令仅选中 1 项，其余 9 项未选中；完整 297 项集成已全部执行。

正式新增/替换测试：`tests/integration/attachment-quota.test.ts`（19）、`workbench.performance.test.ts`（10）、`m5-subresources.test.ts`（10）、`tests/e2e/m5-regressions.spec.ts`（6）、`tests/unit/m5-upload-client.test.ts`（3）。

## 环境处理与限制

- 清理了中断遗留的 4 条迁移锁等待会话及 1 条超过 6 小时、无活动事务的空闲持锁会话；随后按迁移历史正常部署。没有关闭迁移锁、删除迁移历史、重置数据库或修改既有业务记录。
- Windows 的 3100/3115 返回 EACCES；先验证 43127 可绑定，再启动独立服务。没有按端口终止未知进程。
- 畸形 multipart 回归最初暴露未监听的被拒绝文件流错误，已修复。测试按真实入站字节构造畸形请求，避免 Node 26 的出站 FormData 生产器在取消时自行向已关闭流 enqueue；另以真实 HTTP 验证 400 和服务健康，没有屏蔽未处理异常。
- 日志包含 Node 26 localStorage 实验性提示、FORCE_COLOR 提示，以及浏览器刻意中断/切换时 Next 的 destination stream closed early 日志。全量 E2E 的硬清理夹具阶段还出现过一次关联读取 null 日志，发生在测试销毁数据与已发出读取交叠时；断言及全库指纹门禁均通过。最终 M5 回归未出现该 null 日志。
- 当前仓库没有初始 Git commit，文件为未跟踪状态。本轮未提交、未推送；源码忽略问题已修复，但不能宣称已验证远端 clean clone。
- M6 的生产部署、备份恢复、定时清理调度、共享限流与生产压测尚未实施；本次只恢复 M5 本地交付，不代替生产验收。文件格式检查不等于恶意软件扫描。

下一步按 backlog 进入 M6 / ORB-020；M7 仍需明确请求。
