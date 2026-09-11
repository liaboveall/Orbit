# 07 · 测试与质量门槛

## 1. 测试策略

单元测试覆盖日期、权限决策、排序和输入规则；集成测试用真实 PostgreSQL 验证事务/并发/权限；契约测试验证自有API；E2E覆盖主要用户流程。不要用全部mock的成功响应代替后端测试，也不要为纯样式和复制实现逻辑的代码堆测试。

外部邮件/存储/AI在多数测试中使用受控替身，但M1邮件、M5存储和M7 AI各要实际联调。CI使用本地Mailpit/MinIO及测试数据库，不能连接生产账户。计划文件的静态校验不等于本章应用测试。

## 2. 测试矩阵

| ID | 场景 | 层次 / 验证 |
|---|---|---|
| T-AUTH-01 | 注册、验证、登录、退出 | E2E，真实Mailpit；未验证不能进入业务 |
| T-AUTH-02 | 找回、重设、旧会话失效 | integration+E2E；token过期、单次使用 |
| T-AUTH-03 | 非同源请求与非法returnTo | API；阻止CSRF和开放重定向 |
| T-PERM-01 | A/B两个项目、非成员、已移除用户 | API对每类资源进行越权读/写 |
| T-PERM-02 | member执行owner操作 | 403；非成员404；owner不可移除 |
| T-PROJECT-01 | key重名、并发超项目上限 | 数据库；唯一约束与配额正确 |
| T-TASK-01 | 创建、编辑、完成、重新打开 | unit+API；completedAt规则 |
| T-TASK-02 | 同任务两次旧版本写 | 并发integration；一成功一409 |
| T-TASK-03 | 同幂等键并发创建/评论 | integration；仅一行和一个活动 |
| T-TASK-04 | 相同key不同body | 409，原记录不变 |
| T-TASK-05 | 软删除/恢复/归档 | API+E2E；子资源跟随可见性；恢复时项目/任务配额仍受限 |
| T-BOARD-01 | 列内/跨列/列首列尾/空列 | unit+API；稳定顺序与completedAt |
| T-BOARD-02 | 两move共享boardVersion | 并发integration；一成功一409 |
| T-BOARD-03 | position无间隙/边界重编号 | unit+integration；无顺序丢失 |
| T-BOARD-04 | 拖拽500/409/网络中断 | E2E；回滚、提示、可重试 |
| T-BOARD-05 | 筛选/未完整加载/游标过时 | API+E2E；禁拖拽，过时快照重载 |
| T-INVITE-01 | 正常、过期、撤销、已用 | API+E2E；状态明确 |
| T-INVITE-02 | 两用户同时接受/重复接受 | integration；仅一个新成员 |
| T-INVITE-03 | 满员/已成员/归档/幂等创建 | integration；token消耗规则、重放无明文 |
| T-MEMBER-01 | 移除与分配/上传完成竞争 | integration；退出后不残留非法分配/附件 |
| T-COMMENT-01 | 作者编辑、owner删除他人 | API；owner不能编辑他人正文 |
| T-SUBTASK-01 | 上限、version、父状态独立 | unit+API |
| T-FILE-01 | 允许类型/伪装MIME/HTML/SVG/超大/错误摘要 | API；拒绝不合法内容 |
| T-FILE-02 | 并发上传冲配额、取消、中断、存储失败 | integration；无负配额，无幽灵READY |
| T-FILE-03 | 重复uploadId与内容不一致 | API；不重复文件、不绕过校验 |
| T-FILE-04 | 非成员下载/过期签名/删任务 | integration；私有桶无公开读取 |
| T-FILE-05 | 孤儿清理重复运行 | integration；幂等，空间记账正确 |
| T-DATE-01 | UTC午夜、亚洲/美洲、夏令时切换 | unit；date-only不偏移 |
| T-DATE-02 | 今天/逾期/未来7天/无截止/已完成 | API；固定时钟可重复 |
| T-ACTIVITY-01 | 业务失败回滚、重试与无变化更新 | integration；日志同步且无重复 |
| T-CACHE-01 | 换账号、退出、移除成员、后台刷新编辑中 | E2E；缓存不泄漏/草稿不丢 |
| T-A11Y-01 | 键盘创建、弹层焦点、状态菜单 | E2E+人工；主流程无鼠标可用 |
| T-RESP-01 | 390/768/1440px、长文本/空/错 | 浏览器检查+截图 |
| T-DEPLOY-01 | 迁移、双账户冒烟、备份恢复 | staging；保留真实证据 |

## 3. AC与任务追踪

AC-01对应AUTH；AC-02对应PROJECT/TASK；AC-03对应INVITE；AC-04对应PERM；AC-05对应TASK-02/CACHE；AC-06对应BOARD；AC-07对应DATE；AC-08对应COMMENT/SUBTASK/FILE；AC-09对应MEMBER；AC-10对应TASK-05；AC-11对应A11Y/RESP；AC-12对应DEPLOY和发布报告。

每个backlog任务记录至少一条实际evidence。文档矩阵覆盖要求不意味着所有条目都必须各写独立测试文件；可按行为合并，但不能漏掉风险。

## 4. 性能目标及测量方法

以下是待验证预算，不是已达成结果：

- 面向最终真实流量：Core Web Vitals 第75百分位 LCP≤2.5s、INP≤200ms、CLS≤0.1。没有足够真实访问时明确只有实验室数据，不能声称达到真实用户分位。
- 初次可交互工作台：在记录的Chrome版本、1440px、4倍CPU降速、明确网络配置下测试；使用正式构建，连续5次，保存中位数及范围。
- 关键业务JSON读取p95≤300ms、普通写入p95≤500ms：在本地/同区域staging、10并发、每项目1000任务的明确数据集上测量，排除AI/邮件/上传，记录硬件、样本数和错误率。
- 初始看板每列最多50张；TaskSummary不传description；首个看板JSON目标≤250KiB未压缩。实测超预算先分析字段/查询，不删除必要可访问性信息。
- 拖拽与筛选不能造成明显长时间主线程阻塞；用Performance trace定位，不能只依据主观“很丝滑”。

不把Lighthouse的TBT写成INP。只有一个用户时不虚构p95在线指标。图表库、Markdown编辑器和上传处理按需要懒加载；V1无需分析图表库。

## 5. 可访问性与视觉门槛

普通文字4.5:1，大字号与关键非文字控件3:1；状态同时有文字/图标；焦点明显且不被面板遮挡。Dialog正确标题、aria描述、初始焦点与关闭后恢复焦点；toast不能是唯一错误反馈。

自动axe扫描无critical/serious问题作为最低门槛，再人工走主流程。按钮触控区、200%缩放、长中文/URL、减少动画偏好要检查。截图基于稳定fixtures；截图差异须人工确认原因，不能批量更新baseline让测试变绿。

## 6. 安全与数据检查

所有角色、归档态、软删除态、关联资源归属在API层有测试。没有任何文件桶公开读写；下载URL签发前重新鉴权。Markdown不执行HTML/脚本，不读取外部图片；评论始终纯文本。查日志与构建产物不得含凭证/令牌/私有正文。

依赖扫描的问题按实际可达性和修复方案处理，有明确可利用的高危漏洞未处理时不能标记发布完成。不要为了减少告警停用扫描或关闭TLS校验。

## 7. CI与发布验收

每PR：lint → typecheck → unit → contract → integration → production build → E2E smoke。测试数据库隔离，Mailpit/MinIO服务按需要启动。全套E2E在合并前或发布候选运行；不能以“本地通过”替代CI结果。

关键端到端套件固定3条：单用户完整任务生命周期；双用户邀请协作和移除；私有附件上传下载失败恢复。发布前另跑三种视口、键盘、性能与备份恢复。

不设会诱导无意义测试的覆盖率百分比；按关键业务规则覆盖验收。允许记录尚未验证的外部条件，但对应任务不得标为done。
