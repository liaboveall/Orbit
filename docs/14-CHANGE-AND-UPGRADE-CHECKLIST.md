# 变更与升级验收清单

## 新增或修改业务领域

每次先写触发场景、前后行为和验收，再实现。按适用性填写 PR 模板，不靠目录存在性宣称语义正确。

1. 产品/权限：更新 01；角色、归档、软删除、资源归属、未登录和跨账户隔离。
2. 数据：更新 04；Prisma 与新增迁移、外键/CHECK、项目锁顺序、失败补偿；禁止修改已部署迁移。
3. 传输：OpenAPI 为真源，同步 Zod、05 与状态码；覆盖成功、非法输入、权限、冲突和依赖故障。
4. 路由：会话/Origin/额度/运行时校验；业务放 server，不在客户端引用数据库或存储 SDK。
5. 页面：设计 token、loading/empty/error/permission/long-content/mobile；键盘、IME、草稿和后台刷新。
6. 验证：真实 handler + Schema 的 integration 与 OpenAPI 静态互验互补；新增行为必须有相应验证证据，不能用测试总数替代。
7. 交付：backlog 关联审计 ID，记录命令/退出码/限制；运行规划校验和当前摘要校验。依赖未完成不得宣称发布完成。

## 框架及依赖升级

- 先读目标版本官方迁移资料与本地 next/dist/docs，记录起止版本和对应 API；独立分支更新锁文件，不混用 Prisma 主版本示例。
- 所有直接依赖精确版本，pnpm-lock.yaml 冻结安装；Dependabot 提案经过正常回归后合入。dotenv 仅脚本/构建使用，operations 镜像保留构建依赖。
- Next/React：正式构建、RSC/router.refresh、分页窗口保留、loading/error 恢复、无重复内容树、Proxy 请求体限制、headers/params、换账号缓存隔离。
- Radix：390/768/1440、嵌套 Dialog/Drawer/Menu、焦点恢复、组合 Enter/Escape、tab 方向键；不能仅凭源码猜测删掉兼容处理。
- Prisma/pg：生成客户端、迁移、真实事务/并发/池耗尽映射、BIGINT 重编号及删除约束。
- Better Auth：真实邮件验证/找回、STARTTLS 拒绝降级、超限合法 JSON、限流与可信代理、旧会话失效。保留账号枚举取舍，不能自写密码认证来规避库行为。
- SDK/容器：真实本地 S3 兼容存储（SeaweedFS）上传/下载/取消/删除恢复；runner 和 operations 都跑 OS+应用漏洞扫描，扫描失败或高危项必须可见；正式生产环境单独验收。

## 性能与 micro 部署

池默认 5，DATABASE_POOL_MAX 接受 1–20。总连接预算至少包括 web 实例数 × pool、operations、迁移/备份及管理预留。调高连接数前记录池等待、事务持锁、p95、错误率和数据库内存。

对 1000 任务数据集采样 updated_desc/due_asc/priority_desc、项目 all/joined 和附件查询的 EXPLAIN (ANALYZE, BUFFERS)。小范围排序和堆过滤不自动等于缺陷；新增索引须有查询收益和写放大证据，不按 WHERE 字段机械堆索引。

1GiB 同机部署先采集 docker stats、free、vmstat、OOM/restart 和 10 并发响应，覆盖 web 与维护/备份重叠。容器硬上限要高于已测峰值并给宿主留余量；未测量前不发布武断 mem_limit、shared_buffers 或 work_mem。持续 swap/OOM 则减并发或升级实例，不把本机结果当真云容量验收。

## 审计材料与公共契约

历史源码快照是恢复证据，保留在已忽略的 artifacts，不强制加入 Git。不要为了节省空间自动删除事故材料。EMAIL_UNVERIFIED / ALREADY_EXISTS 是既有公共错误码，保留兼容并标明当前业务无抛出点，不因搜索不到调用点破坏枚举协议。

官方依据：[Nginx 请求限流](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)、[连接限制](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html)、[WAI Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)、[pg Pool](https://node-postgres.com/apis/pool)、[PostgreSQL 17 内存参数](https://www.postgresql.org/docs/17/runtime-config-resource.html)、[Trivy 容器扫描](https://trivy.dev/docs/latest/target/container_image/)。
