# 有序 Orbit · 完整项目开发规划

版本1.0 / 2026-09-08。此文件是专题文档的阅读副本；修改源文件后重新生成。实际实现和验收状态以 PROGRESS.md 为准。

开发Agent从 [README](README.md)、[AGENTS](AGENTS.md) 和 [当前进度](PROGRESS.md) 入手，按里程碑加载专题；不要把本阅读副本与全部源文件重复加载。机器契约见 [OpenAPI](contracts/openapi.json)，任务见 [backlog](planning/backlog.json)。

<!-- Source: docs/00-EXECUTION-OVERVIEW.md -->
# 00 · 执行总览

## 目标

交付一个真实可用、视觉统一、可维护的学生小团队协作产品。招聘展示的重点是：完整的前后端业务、准确的数据与权限、流畅的交互、可复现的工程过程。不会承诺单凭项目获得录用。

## 已确定的默认决策

| 事项 | 决策 |
|---|---|
| 产品 | 有序 Orbit，个人与 2—10 人学生小团队项目协作 |
| 使用端 | Web，桌面优先，手机支持核心操作 |
| 默认语言 | 简体中文；代码和接口字段英文 |
| 数据组织 | 用户直接拥有/加入项目，不加 workspace/organization 层 |
| 权限 | OWNER 与 MEMBER；ownerId 为所有者唯一来源 |
| 任务状态 | TODO、IN_PROGRESS、DONE；V1 固定三列 |
| 任务负责人 | 最多一人，可不分配 |
| 编辑方式 | 显式保存；不实现富文本实时协同 |
| 内容格式 | 描述为受限 Markdown，评论为纯文本 |
| AI | V1.1 才接入，用户审核后创建正式任务 |
| 认证 | Better Auth 邮箱密码、邮箱验证、找回密码；本地用 Mailpit |
| 实时体验 | 乐观更新 + 失焦恢复/定时刷新；V1 无 WebSocket |
| 存储 | PostgreSQL；附件在私有 S3 兼容存储 |
| 架构 | Next.js 模块化单体，REST API，业务与路由分层 |
| 生产形态 | 持续运行的 Node 容器 + 托管 PostgreSQL/对象存储/邮件服务 |
| 开发环境 | Windows/macOS/Linux；文档命令避免依赖 Bash 专有语法 |

## 发布边界

M0—M2 得到个人任务管理的纵向闭环；M3—M5 完成看板和协作；M6 完成部署与质量门槛。只有 M0—M6 全部验收后称为 V1。M7 是独立的 V1.1，缺少 AI Key 不能阻塞 V1 发布。

## V1 最终完成定义

1. 干净环境按 README 可启动应用、执行迁移和加载明确标注的演示数据。
2. 两个真实测试账户可完成注册验证、邀请加入、任务协作、评论、附件和退出流程。
3. 非成员不能通过页面、API、关联对象 ID 或附件链接申请接口读取项目内容。
4. 并发编辑、拖拽失败、上传失败、重复提交、成员退出均有确定行为与关键测试。
5. 页面符合视觉规范，在 390、768、1440px 宽度检查核心流程；键盘可完成等价操作。
6. 持续集成、迁移、私有存储、邮件、日志和备份恢复验证完成；有实际部署地址。
7. README、架构说明、接口、关键决策、测试报告、演示视频脚本与真实测量结果齐全。

## 规范的唯一来源

- 功能与权限：01。
- 页面布局与交互：02。
- 技术边界与生命周期：03。
- 字段、索引、事务和状态不变量：04。
- 网络结构：contracts/openapi.json；网络行为：05。
- 任务完成情况：planning/backlog.json 和 PROGRESS.md。
- AI 扩展：09，不隐式修改 V1。

多个文件描述同一规则时，不得通过后写的一份悄悄覆盖先前约定；修改需同时更新受影响文件和测试。遇到普通实现细节，按本规划默认选择执行并记录。

## 时间和投入

以有 React 与基础后端经验、单人使用 AI 辅助开发为假设，V1 约 100—150 小时，V1.1 约 16—24 小时，另留 20% 缓冲。按每周 20—25 小时约 5—8 周；初学者应增加学习时间。估算用于安排，不是工期保证。

优先级依次为：数据与权限正确、完整流程、清晰界面、可靠部署、性能优化、额外功能。


---

<!-- Source: docs/01-PRODUCT-SPEC.md -->
# 01 · 产品需求与业务规则

## 1. 用户与价值

主要用户是管理个人开发计划、课程设计、比赛或小组作业的学生。个人用户需要知道今天做什么；小团队需要知道任务由谁负责、进展如何、讨论与成果放在哪里。

典型流程：注册验证 → 创建项目 → 邀请队友 → 创建与分配任务 → 看板推进 → 在任务中讨论并上传成果 → 完成或归档项目。

不做企业组织管理、计费、即时通信、工时核算或复杂流程配置。V1 的规模目标是每项目最多 20 人（含 owner）、1000 个未删除任务、每任务 50 个未删除子任务、1000 条未删除评论、5 个有效附件。

## 2. 产品成功标准

- 新用户能在 3 分钟内创建第一个项目和第一条任务；测试时排除收取验证邮件的外部等待。
- 常见任务可在看板/列表中一步打开详情，并在原上下文返回。
- 真实双账户协作流程可演示，刷新后数据正确保留。
- 5 位自愿试用者的主要阻碍有记录并处理；人数不足时如实记录，不伪造用户数据。
- 交付指标来自测试和测量；功能数量、代码行数不作为质量指标。

## 3. 账户（FR-AUTH）

邮箱密码注册，邮箱验证后登录，支持退出、找回密码、重设密码。认证交给 Better Auth；不自写密码哈希、JWT 或验证令牌算法。登录成功去 /app/today，存在合法同源 returnTo 时返回原页面。

姓名 1—40 字符，邮箱按认证库规则处理；密码长度配置 12—128，不额外强制大小写符号组合。登录/找回失败文案避免泄露账户是否存在。重设密码后撤销既有会话。用户可修改姓名和 IANA 时区；V1 不支持修改邮箱、账户删除或社交登录。

默认时区取首次注册浏览器合法 IANA 时区，不可识别时 Asia/Shanghai；服务端验证时区。头像使用姓名首字母/文字占位，V1 不上传头像。

## 4. 项目与权限（FR-PROJECT）

项目字段：名称 1—80、标识 key 2—8 位大写字母数字且首位为字母、描述最多 2000、颜色从 6 个固定色选择。key 全局唯一，创建后不可修改，用于 ORB-12 形式的任务编号。每用户最多拥有 10 个未归档项目；恢复归档项目时也检查该上限，超限保留归档状态。

Owner 是 Project.ownerId 指向的用户；ProjectMember 仅保存其他成员，不冗余保存 OWNER 角色。V1 不转移所有权。Owner 可归档/恢复项目，归档后所有成员仍能阅读。项目不提供永久删除功能。

| 操作 | Owner | Member | 非成员 |
|---|---|---|---|
| 阅读项目、任务、评论、活动 | 是 | 是 | 否 |
| 创建/编辑/分配/移动任意任务 | 是 | 是 | 否 |
| 删除/恢复任务 | 是 | 仅任务创建者 | 否 |
| 新建/编辑/删除子任务 | 是 | 是 | 否 |
| 发布评论 | 是 | 是 | 否 |
| 编辑评论 | 仅自己 | 仅自己 | 否 |
| 删除评论 | 任意 | 仅自己 | 否 |
| 上传附件 | 是 | 是 | 否 |
| 删除附件 | 任意 | 仅自己上传 | 否 |
| 修改项目/归档恢复/创建邀请 | 是 | 否 | 否 |
| 查看及撤销邀请 | 是 | 否 | 否 |
| 移除其他成员 | 是 | 否 | 否 |
| 退出项目 | 不可，提示先归档 | 是 | 不适用 |

归档项目只读，但允许 owner 恢复、撤销邀请、移除成员，以及 member 退出。包括删除、恢复任务在内的其他业务写操作均返回 PROJECT_ARCHIVED。个人资料、密码、登录等账户操作不受项目归档影响。

成员退出/被移除：立即失去服务端访问权限；其未删除任务的 assigneeId 置空并增加任务 version；创建者、历史评论、活动作者保留。不能移除 owner。操作日志保留退出事件。已有短期下载链接最多保留至 60 秒过期。

## 5. 邀请（FR-INVITE）

Owner 生成一次性邀请链接，手动复制给队友；产品不自动发送项目邀请邮件。链接默认 7 天有效，可提前撤销；每项目最多 20 条有效未使用邀请。邀请 token 为 32 随机字节的 URL 安全编码，数据库只存 SHA-256 摘要。

链接形如 /invite#token=...；客户端仅在内存/sessionStorage 临时保存并通过 POST body 提交，避免 token 进入查询串、Referer 和访问日志。邀请页不加载第三方统计，设置 no-referrer。身份验证完成后返回邀请页；接受/撤销后清除临时 token。

持有链接且登录、邮箱已验证的用户可以接受。接受操作原子地创建成员关系并标记邀请已使用；不同用户并发只能一个成功。同一已接受用户重试返回同一结果。已经是该项目成员/owner 时返回已有成员身份，不消耗一条尚未使用的邀请。

过期/撤销/已被其他用户使用显示明确失效状态；达到人数上限则不消耗 token；归档项目不允许接受邀请。

## 6. 任务（FR-TASK）

字段：标题 1—120；描述 Markdown 最多 10000；状态 TODO/IN_PROGRESS/DONE；优先级 NONE/LOW/MEDIUM/HIGH；负责人 0 或 1 人；截止日 YYYY-MM-DD 或空。标题前后空白去除，不能全空格。用户只能选择该项目 owner 或当前成员作为负责人。

默认 TODO、MEDIUM、无负责人、无截止日。创建者由会话确定，不接受客户端 creatorId。任务编号在项目内递增，已删除编号不复用。V1 不支持跨项目移动、标签、依赖关系和自定义状态。

任务编辑显式保存；保存时携带 expectedVersion。版本过期返回 409，保留用户草稿并提供重新加载/复制草稿，不自动覆盖他人修改。描述文本支持标题、列表、代码块和普通链接，禁用原始 HTML、外部图片、iframe、脚本和危险 URL。

切换 DONE 设置 completedAt 为服务端当前 UTC 时间；离开 DONE 清空；重复设置相同状态不刷新 completedAt。完成任务不会自动勾选子任务；未完成子任务只做提示，不阻止完成。子任务变化不自动改变父任务状态。

任务软删除：记录 deletedAt，不出现在常规列表、工作台和看板；详情、评论、附件 API 返回 404。回收站显示标题/编号/删除时间等最小恢复信息；只有 owner/创建者能恢复。V1 保留软删除记录，不自动永久清除。恢复同样检查1000个未删除任务上限；成功后保留原状态，追加到对应列末尾；若原负责人已退出则置空。

## 7. 列表与看板（FR-BOARD）

列表支持项目内标题/编号搜索、状态、负责人（我/未分配/成员）、优先级、逾期筛选；分页默认 30，最大 100。默认 updatedAt DESC, id DESC。排序支持更新时间、截止日、优先级，所有排序均追加稳定的 id 排序；空截止日排最后。

看板固定三列，可列内拖拽、跨列拖拽。默认每列先显示 50 张，按 position,id 排序，可加载至该列全部任务。列头显示匹配总数。仅在没有筛选且三列都完整加载时开启拖拽排序；其他情况显示“加载全部后可排序”，仍可用任务菜单修改状态并追加到目标列末尾。

筛选参数写入 URL，刷新与分享后保持；切换视图保留适用筛选。已软删除和归档项目内容不出现在“我的工作台”；归档项目自身可以阅读历史看板。

拖拽成功前进行本地乐观更新；失败回滚并提示。一个项目同一浏览器同时只提交一个 move 请求，避免本地回滚覆盖后续操作。出现冲突刷新看板，用户可以重试；不要自动重新应用旧位置。

V1 不承诺实时协同。可见页面每 30 秒后台刷新一次，并在窗口重新聚焦、写操作完成后刷新相关数据；文本编辑期间保持本地草稿。成员被移除后，下一次请求清空缓存并退出项目页。

## 8. 子任务、评论、附件与活动

子任务（FR-SUBTASK）：标题 1—200，单层清单，有完成状态；按创建顺序显示，V1 无拖拽、独立负责人和截止日。修改带子任务自己的 version，不改变父任务 version；新增/更改更新父任务 updatedAt。

评论（FR-COMMENT）：纯文本 1—2000，按 createdAt,id 升序分页，每页 30。本人可编辑，显示“已编辑”；软删除显示“评论已删除”且清除响应正文，保留讨论顺序。V1 无回复树、表情、@通知。创建评论有幂等键，避免重试重复发布。

附件（FR-FILE）：每次 1 文件、每文件不超过 10 MiB、每任务最多 5 个 UPLOADING/READY 附件、每项目 200 MiB（包含上传预留）。允许 PDF、PNG、JPEG、WebP、UTF-8 TXT、MD；检查扩展名、内容类型和实际内容，拒绝 HTML、SVG、可执行文件和压缩包。通过服务端流式上传到私有存储；显示上传/失败/重试状态。只提供下载，V1 不做 PDF/图片在线预览。仅 READY 可下载，下载前重新鉴权，签名 60 秒过期并强制 attachment。

活动（FR-ACTIVITY）：记录项目更新/归档、成员加入退出、任务创建/字段变更/移动/删除恢复、子任务变更、评论增改删、附件增删。日志与对应业务写入同一数据库事务，不保存评论/描述完整内容、密码、token 或 signed URL。显示操作者、事件、对象、时间；已删除任务的活动保留编号，不泄露正文。

## 9. 我的工作台（FR-TODAY）

只统计当前用户是负责人、未删除、未归档项目中的任务；不自动把“我创建但分配给别人”的任务加入。

- 逾期：dueDate 早于用户时区今天，且非 DONE。
- 今天到期：dueDate 等于今天，且非 DONE。
- 未来 7 天：今天之后至今天+7天（含）到期，且非 DONE。
- 进行中：状态 IN_PROGRESS，不受日期限制。

这些分类不是互斥集合，计数不可相加当总数。另提供“全部未完成/已完成”列表入口。没有截止日的任务可出现在进行中/全部，不出现在日期分类。日期由后端按用户时区计算，客户端显示相同结果。

## 10. 核心验收场景

- AC-01：注册并验证邮箱后可登录，退出后 API 返回 401。
- AC-02：创建项目与任务，刷新后仍存在，编号不重复。
- AC-03：邀请一次性接受、过期、撤销、多人竞争均符合规则。
- AC-04：非成员无法访问项目及任意嵌套资源；成员不能执行 owner 操作。
- AC-05：两浏览器同时修改同任务，第二次旧版本写返回 409 且草稿保留。
- AC-06：拖拽成功持久化；失败回滚；排序在刷新后稳定。
- AC-07：日期跨时区显示一致，完成任务不再出现在逾期计数。
- AC-08：评论、子任务、私有附件在权限内工作，并生成活动。
- AC-09：退出/移除成员清空其分配且立即阻止新的资源访问。
- AC-10：任务删除/恢复与项目归档/恢复的可读写行为正确。
- AC-11：390px 和键盘下可完成任务创建、查看、修改状态。
- AC-12：生产部署、迁移、备份恢复、关键测试和真实测量证据齐备。


## 2026-09-11 · M5 协议冲突关闭

附件 uploadId 保持 UUID；内部 DELETED + deletedAt 同步，公开 DTO 不返回 DELETED。下载端点保持 Download JSON，url 为 60 秒有效且绑定当前用户的应用签名链接。GET /attachments/{attachmentId}/content 校验签名、当前会话、当前项目成员、父任务未删除和附件 READY 后代理私有 S3 流，强制 attachment、private,no-store；不向客户端暴露 objectKey。该选择取代先前签名存储 URL 与直接二进制响应混用的实现。

上传先持久预留，再有界流接收至私有临时文件并校验实际内容/大小/摘要、流写 S3，最后独立事务复核权限并提交 READY。请求总时限 120 秒；临时文件请求结束删除。维护命令 cleanup:attachments 处理一小时以上失效上传及 cleanupPending 对象；FAILED/DELETED 的待删标志保留至少 3 分钟，让取消中的 PUT 结束后再物理删除。对象删除失败保留待重试标志，已清理对象不重复释放配额。


---

<!-- Source: docs/02-UX-AND-DESIGN.md -->
# 02 · 页面、交互与视觉规范

## 1. 设计方向

Orbit 的气质是清晰、安静、可信。主要视觉来自排版、对齐、留白和状态反馈。避免大面积渐变、玻璃拟态、夸张阴影、无信息价值的装饰图表，以及每段文字都装入卡片的布局。

官网仅用于学习信息层级与克制用色。自行绘制 Orbit 字标/简洁轨道线图形，不使用他人品牌素材。V1 无需 ImageGen 图片或复杂插画；空状态使用简单线形图标配操作引导。

## 2. Design tokens

| 变量 | 初始值 | 用途 |
|---|---|---|
| background | #F7F8FA | 应用背景 |
| surface | #FFFFFF | 卡片、对话框、侧栏 |
| text-primary | #171A21 | 正文/标题 |
| text-secondary | #5B6472 | 次要说明 |
| text-muted | #6B7280 | 辅助文字，实际对比度须测试 |
| border | #E2E6ED | 装饰分隔 |
| border-control | #7D8798 | 需要清楚识别边界的交互控件 |
| brand | #355CFF | 主按钮、选中态、焦点 |
| brand-soft | #EDF1FF | 浅选中背景 |
| success | #18794E | 完成/成功，配图标与文案 |
| warning | #8A5700 | 临近截止，配文案 |
| danger | #B42318 | 错误/破坏性操作 |
| focus-ring | 2px brand + 2px offset | 键盘焦点 |

上述颜色是设计起点，不是已通过对比度检测的结果。正文要求 WCAG AA 4.5:1，大字号 3:1，关键控件与焦点边界 3:1；测试不合格时调整 token 并记录。

字号：12（极少量辅助）、14（标签/任务卡）、16（正文）、20（区域标题）、28（页面标题）、40（介绍页主标题）。正文字号不得为了塞内容降低到 12。正文行高 1.6，标题 1.25。英文/数字字体 Inter 或系统无衬线，中文系统字体栈；优先系统字体，避免首版引入大体积中文字体下载。

间距使用 4/8/12/16/24/32/48。输入框/常规按钮高 40，触控端主要目标至少 44。控件圆角 8、卡片 12、弹层 16。影子只用于悬浮层和拖拽浮层。动效 120—180ms，以 opacity/transform 为主；遵从 prefers-reduced-motion。

项目颜色：蓝、紫、青、绿、橙、灰 6 个固定 token，仅用于项目标记，不替代状态或权限标识。

## 3. 信息架构与路由

| 路由 | 页面 | 访问 |
|---|---|---|
| / | 简洁介绍页：用途、产品截图、开始使用、只读演示 |
| /login | 登录 | 访客 |
| /register | 注册 | 访客 |
| /verify-email | 验证邮件提示/回调结果 | 访客 |
| /forgot-password | 申请重置 | 访客 |
| /reset-password | 设置新密码 | 持有效认证库 token |
| /invite | 邀请预览与接受；token 在 fragment | 访客预览，已验证用户接受 |
| /demo | 与真实账户隔离的只读合成数据展示 | 公开 |
| /app/today | 我的工作台 | 登录 |
| /app/projects | 项目列表（我的/参与的/已归档） | 登录 |
| /app/projects/[projectId]/board | 看板 | 项目成员 |
| /app/projects/[projectId]/tasks | 任务列表 | 项目成员 |
| /app/projects/[projectId]/tasks/[taskId] | 可直达的任务详情 | 项目成员 |
| /app/projects/[projectId]/activity | 项目活动 | 项目成员 |
| /app/projects/[projectId]/settings | 项目与成员设置 | 成员可读，owner 管理 |
| /app/projects/[projectId]/trash | 回收站 | 成员可读，按权限恢复 |
| /app/settings | 姓名与时区 | 登录 |

列表/看板用 ?task=<id> 打开详情侧面板，关闭时移除 task 参数并保留过滤条件。直接详情 URL 使用同一详情组件的独立页面布局；禁止为了这一需求先引入复杂平行路由。复制任务链接使用独立详情 URL。

## 4. 应用外壳

桌面 ≥1280：左侧 224px 侧栏，顶部 64px 工具栏，内容内边距 32。侧栏包含字标、我的工作台、项目、最近项目（最多 6 个）、底部个人设置。页面主标题只出现一次。项目页头显示项目标记、名称、成员头像占位、创建任务按钮；二级导航为看板/列表/活动/设置。

768—1279：侧栏收窄至 72px，保留 tooltip 和可访问名称；内容内边距 24。

<768：顶部抽屉导航，内边距 16，任务详情占满屏。默认任务列表；看板按状态 tab 一次显示一列，并使用任务菜单修改状态，无触屏拖拽要求。表格转为任务行卡片，不强制全页面横向滚动。

长项目名称截断并提供完整名称 tooltip/详情，不能推挤主操作。加载时外壳尺寸稳定；避免屏幕全部变成旋转图标。

## 5. 页面规格

### 我的工作台

顶部：“今天，先把重要的事做好。”下面显示用户时区日期。四个紧凑统计入口为逾期、今天、未来 7 天、进行中；正文用分组任务列表，展示任务标题、项目、优先级、截止日。统计入口是可点击筛选，有选中态与文本说明。数据不是互斥集合，不显示误导的合计饼图。

首次无任务：“还没有分配给你的任务。创建一个项目，开始安排第一步。”操作为创建项目。任务全部完成：“今天安排的任务已完成。”不自动播放庆祝动画。

### 项目列表

默认列表/简洁卡片，每项目显示名称、描述摘要、成员数、未完成任务数、归档标记。顶部创建项目对话框；全局唯一 key 在提交时检查，冲突在字段旁提示。已归档项目单独 tab，默认不混入活动项目。

### 看板

~~~text
项目标记  校园活动报名系统                  [成员]  [+ 新建任务]
看板  列表  活动  设置
[搜索任务]  [负责人] [优先级] [逾期]        [清除筛选]

待办 12                  进行中 4                 已完成 8
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ CAMP-12     高    │    │ CAMP-08     中    │    │ CAMP-02     中    │
│ 完成活动详情页   │    │ 接入报名接口     │    │ 明确数据结构     │
│ 子任务 2/4       │    │ 评论 3           │    │                  │
│ 09/12    [成员]  │    │ 09/10    [成员]  │    │ 09/07    [成员]  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
~~~

任务卡内容不超过 5 行：编号/优先级、标题两行、子任务/评论/附件计数、截止日/负责人。最多一个重点色状态。高优先级和逾期分别用图标/文案，不把所有卡片都染红。hover 可显示更多菜单，但键盘焦点时必须同样可见。

拖拽时保留原位置占位，目标插入线清晰。拖动浮层轻微抬升，无旋转/缩放夸张效果；屏幕阅读器宣告移入列。加载不完整/筛选时禁用排序并解释原因。选中卡片在详情面板打开期间保留可辨识状态。

### 任务详情

桌面面板宽 560—640px，内容高度独立滚动。顶部编号、复制链接、更多菜单、关闭；标题下按状态、优先级、负责人、截止日排列；接着描述、子任务、附件、评论。任务操作的 loading 局部展示。

面板采用模态 Drawer：桌面右侧展示、手机全屏展示，打开时焦点进入面板并隔离背景。Tab/Shift+Tab 在面板内循环；Escape、关闭按钮和点击遮罩共用未保存更改确认。关闭后恢复到触发任务卡；直链进入或跨断点导致原卡片隐藏时恢复到可见看板。独立详情 URL 保持普通页面语义。此规则于 2026-09-08 的 M0 复核修正中明确。

标题和描述进入编辑模式后出现保存/取消，保存成功后退出编辑。有未保存更改时关闭/切换任务给出“保留编辑/放弃更改”对话框。409 冲突保留草稿和原编辑版本；重新加载后同时展示远端标题、描述及本地输入。用户明确选择采用远端或保留本地后才推进版本，后续远端再变化仍返回409；获取失败保留原基准并允许重试。取消编辑不触发写请求。嵌套确认框的 Escape 只关闭最上层，保留详情与草稿并恢复触发焦点。

创建任务对话框只要求标题；项目内自动确定 projectId；其余字段逐步展开。Enter 在标题输入可提交，描述内 Enter 换行；Ctrl/Cmd+Enter 提交表单。系统快捷键不覆盖浏览器常用快捷键；V1 不做全局命令面板。

### 评论与附件

评论输入框明确“发表评论”，提交成功才清空；失败保留原文。已编辑显示时间，删除后保留占位。附件行显示文件名、格式、大小、上传者和状态；超限前端尽早提示，但以后端判断为准。上传失败提供重试/移除，不假装完成。下载失败不清空详情。

### 项目设置与回收站

设置分项目资料、成员、邀请、归档四个区域。成员能看到资料和成员列表以及自己的退出入口，管理操作只对 owner 显示。邀请 token 只在新建成功时展示一次并允许复制；已有邀请仅显示创建时间/到期时间/状态及撤销按钮，无法从服务端取回原 token。

成员退出/移除确认文案：“将取消该成员的任务分配，并保留历史讨论。”归档提示“项目将变为只读，可随时恢复”。删除任务进入回收站，提供短暂撤销入口；回收站只显示摘要，恢复权限不足不显示操作按钮。

### 介绍页与演示

介绍页一屏主张、一张应用真实截图、三项功能、开始使用与只读演示即可。演示数据是构建时合成数据，不接入真实私有项目；/demo 所有写操作明确提示“演示模式，登录后创建自己的项目”。不提供全网共享写权限的演示账号。

## 6. 组件清单

基础：Button、IconButton、Input、Textarea、Select/Combobox、Dialog、Drawer、Tooltip、DropdownMenu、Tabs、Badge、Avatar、Skeleton、Toast、InlineError、EmptyState、Pagination。

业务：AppShell、ProjectHeader、TaskRow、TaskCard、BoardColumn、TaskDetail、TaskEditor、MemberPicker、DueDatePicker、PriorityBadge、SubtaskList、CommentThread、AttachmentList、ActivityItem、ConflictNotice。

使用 Radix/headless 基础原语解决焦点/弹层，不另造不可访问的基础组件。样式通过 token 统一。日期选择器必须支持键盘及直接输入日期。

## 7. 必须验证的状态矩阵

| 状态 | UI 行为 |
|---|---|
| 首次加载 | 对应布局 skeleton，无明显布局跳动 |
| 后台刷新 | 保留已有内容，小范围刷新提示 |
| 真正无数据 | 解释价值并提供下一步 |
| 筛选无结果 | 显示“没有匹配任务”及清除筛选 |
| 网络失败 | 局部错误、重试、保留草稿 |
| 未登录/会话过期 | 跳登录并保留合法 returnTo，不在 URL 放私有内容 |
| 无权限/不存在 | 统一不可访问页面，不泄露项目名称 |
| 项目归档 | 顶部只读提示，禁用业务写入口 |
| 版本冲突 | 保留输入、说明原因、重新加载 |
| 长中文/英文/URL | 合理折行；卡片截断，详情完整显示 |
| 减少动画 | 取消非必要过渡，状态仍清楚 |

## 8. 设计交付与验收

M0 产出三张关键页面布局草图（工作台、看板、详情）和可浏览的组件样例页，仅开发环境可见。M3/5 产出 390、768、1440px 截图；M6 保存到 artifacts/ui/，记录浏览器、视口、fixture 与日期。

允许开发 Agent 在规范内微调视觉；若改变导航结构、主要流程或 token 系统，需要先更新本文件。视觉对比截图只能证明一致性，不能替代真实键盘操作与主流程测试。

### 草稿与后台刷新补充（2026-09-11）

已有评论/子任务列表在后台网络失败或 500 时持续挂载，显示局部错误和重试；首次读取失败才显示整块错误态。远端更新不替换正在编辑的文字及原 expectedVersion。提交期间冻结对应输入，失败后恢复编辑并保留草稿。

详情关闭统一检查父任务、评论、子任务、附件选择和在途上传；明确放弃才关闭。关闭嵌套弹框、取消导航或浏览器后退不清除草稿。关闭时取消未完成上传，但不能承诺撤销已到达服务端的保存。

同账号/项目/筛选刷新重取已加载分页范围，读取期间保持内容和高度；上下文改变清空旧窗口，过期请求不得回写。看板全量加载后刷新/移动保持排序所需范围，重新读取期间禁用排序。


---

<!-- Source: docs/03-ARCHITECTURE.md -->
# 03 · 技术架构

## 1. 技术决策

采用 Next.js 模块化单体。网页与 API 同源，业务层独立于 Route Handlers，后续可以拆出独立后端，但 V1 不为展示“全栈”重复搭建网关和服务。

| 层 | 基线 | 使用边界 |
|---|---|---|
| Runtime | Node.js 24 LTS、pnpm | 不用 Edge 运行数据库/附件处理 |
| Web | Next.js 16 App Router + 配套 React 稳定版 | public 页面/外壳服务端渲染，交互局部 client |
| Language | TypeScript strict | DTO 显式定义，不泄露 ORM 对象 |
| UI | Tailwind CSS、Radix primitives、Lucide | 以 tokens 为视觉源；只选一种组件原语体系 |
| Client data | RSC + createApiClient / API 直调 | 服务器组件直查为数据真源；写操作后 router.refresh()；分页用请求代次绑定防旧响应污染；筛选在 URL，草稿在局部状态 |
| Forms | React Hook Form + Zod | 与 API 校验共享限制，服务端仍重新校验 |
| Drag | @dnd-kit/core + sortable，选兼容版本 | 键盘/菜单替代、失败回滚 |
| Persistence | PostgreSQL 17 + Prisma 7 + PostgreSQL adapter | SQL 迁移补充 ORM 不支持的约束 |
| Auth | Better Auth + Prisma adapter | 邮箱密码、验证、重置、数据库会话 |
| Storage | 私有 S3 兼容 API | 本地 MinIO，生产 S3 兼容供应商 |
| Email | SMTP adapter | 本地 Mailpit，生产已配置的邮件服务 |
| Testing | Vitest、Playwright | 真 PostgreSQL 做集成测试 |
| CI/deploy | GitHub Actions、Docker | 单一标准 Node 容器部署路径 |

M0 读取官方版本资料并记录实际依赖到 docs/versions.md（由开发 Agent 创建），提交 pnpm-lock.yaml。上述是选定主版本，不声称全部都是当日最新。Prisma 7 使用相应生成器、driver adapter 和配置文件，不抄 Prisma 6/8 API。若兼容性验证失败，记录具体错误与最小替代决策，不无故整体换栈。

## 2. 结构

~~~mermaid
flowchart LR
    B[浏览器 / React] -->|同源 HTTPS / JSON| R[Next.js Route Handlers]
    S[Server Components] --> A[会话与授权]
    R --> A
    A --> D[领域服务]
    D --> P[Prisma / SQL 事务]
    P --> DB[(PostgreSQL)]
    D --> F[附件适配器]
    F --> O[(私有对象存储)]
    AU[Better Auth] --> DB
    AU --> M[邮件适配器]
    M --> SMTP[Mailpit / SMTP]
    C[维护命令] --> DB
    C --> O
~~~

## 3. 预期目录（M0 建立）

~~~text
src/
  app/                     # 页面和 /api/v1；auth 挂 /api/auth
  components/ui/           # 通用视觉原语
  features/
    auth/ projects/ tasks/ board/ comments/ files/ activity/ today/
  contracts/               # Zod schema、DTO、错误码；无服务端依赖
  server/
    auth/                   # Better Auth、会话、项目授权
    db/                     # Prisma singleton、事务帮助函数
    modules/                # project/task/invite/comment/file 等服务
    integrations/           # storage、mail、未来 AI provider
    http/                   # 错误映射、origin 验证、请求 ID、限流
  lib/                      # 确实跨功能的纯工具，不能成为杂物目录
  styles/                   # tokens、globals
prisma/                     # schema、迁移、seed
tests/unit/ integration/ e2e/ contract/
scripts/                    # seed、清理、导出测试报告
infra/                      # compose、Dockerfile、部署说明
artifacts/                  # 实际报告与截图（大文件按需忽略）
docs/ planning/ prompts/ contracts/  # 本规划
~~~

不预创建几十个空服务。只在当前里程碑需要时创建模块。server-only 保护含凭证、数据库和内部授权逻辑的模块。

## 4. 请求生命周期

业务 API：请求 ID → 验证 Origin/Content-Type/大小/限流 → 会话检查 → schema 校验 → 确定所属项目 → 领域服务内再次授权 → 事务 → DTO → 统一响应。

项目写操作统一在短事务里锁定 Project 行，重新检查 archived 状态与成员权限，再修改资源。统一锁顺序 User（仅影响owner项目配额的创建/归档/恢复）→ Project → Task → 子资源，避免配额、成员退出与任务分配竞争。普通任务写无需User锁。V1 的人数/规模下接受同项目写操作串行化，优先正确性；不同项目仍可并发。不得在持锁期间请求 SMTP、S3 或 AI。

业务失败抛领域错误，HTTP 层负责映射；不把 SQL 错误、堆栈或第三方响应直接返回用户。Server Components 可直接调用同一授权查询服务，不通过服务器 HTTP 绕一圈，也不能跳过权限。

## 5. 认证和安全边界

会话使用 Better Auth 数据库会话与安全 cookie；生产 Secure、HttpOnly、SameSite=Lax，使用库支持的设置，不手动伪造 cookie。不要将 session token 放 localStorage。

所有自有变更 API 仅接受同源浏览器请求，检查 Origin 与配置的可信源；缺失/不匹配 Origin 拒绝。JSON 请求要求 application/json，上传要求 multipart/form-data。库自有 auth 路由使用其内置 CSRF/可信源控制，不包一层破坏回调的自制逻辑。测试客户端同样发送合法 Origin。

组件路由重定向只是体验，数据安全在服务端授权。对非成员返回 404，项目成员执行超权限操作返回 403。资源 ID 不构成权限证明。响应、服务端页面和签名链接不进入公共 CDN 缓存。

V1 不引入数据库 RLS；所有查询必须经过项目授权服务，并用越权集成测试证明隔离。后续如果引入直接客户端访问数据库，必须重新设计授权，不能沿用此假设。

## 6. 客户端状态和数据流

当前实现的数据真源是 **Server Component 直查**：页面在服务器组件里经领域服务读取权威数据，以 props 下发给客户端组件。客户端不维护第二套缓存真源；`@tanstack/react-query` 虽作为依赖存在，但当前 `src`/`tests` 全仓未导入 `useQuery`/`useMutation`/`QueryClient`（见 `src/features/shell/providers.tsx` 的数据真源说明）。V1 不为兑现历史规划强行引入 TanStack Query。

写操作通过 `createApiClient` 直调对应 `/api/v1` 端点；成功后调用 `router.refresh()` 让服务器组件重新读取权威数据，而非在客户端手动失效/合并缓存。因此不存在 query key、`invalidates`、`cancelQueries` 这类客户端缓存语义。

分页/无限滚动使用**请求代次绑定**（`generationRef`，见 `src/features/activity/ActivityFeed.tsx`、`src/features/projects/project-list-client.tsx`）：每次首屏重置或卸载递增代次，仍在飞行的旧响应落地时发现代次不匹配即整体丢弃，防止旧上下文响应污染新数据。dedupe-by-id 不足以防护来自不同筛选上下文的旧响应，故以代次为准。

草稿、弹窗、拖拽状态留在局部 React state；V1 不引入全局 Redux/Zustand。列表筛选、视图和打开任务 ID 在 URL 中；不把描述、评论、凭证写 URL。加载态用 skeleton，与过期（stale）内容区分。

## 7. 附件流程

1. 接收文件元信息并验证项目/任务、类型、配额；短事务内创建 UPLOADING 行和预留空间。
2. 服务端流式读取，限制字节数并检查文件头/UTF-8；使用不可猜测的对象 key 写入私有桶。不信任 Content-Length、扩展名或客户端 MIME。
3. 上传完成后再次短事务锁 Project 并重新授权；若期间成员退出、任务删除或项目归档则不发布附件，标记失败并清理对象。
4. 成功时更新 READY、实际大小、摘要，记活动。API 才返回成功。
5. 中断/失败释放预留、删除对象；清理失败记录待清理状态。维护命令回收超过 1 小时的 UPLOADING 和失败孤儿。
6. 下载先校验成员关系与任务未删除，再生成 60 秒 signed GET；强制下载，不直接渲染附件。

不实现先返回“成功”再异步猜测文件是否存在的流程；也不让浏览器提交任意 bucket/objectKey。V1 上传由持续运行 Node 服务承载，反向代理设置合适请求体上限，不能部署到不支持此大小的请求环境而不修改设计。

## 8. 错误、可观测性和限流

结构化日志目标字段：requestId、route、method、status、durationMs、userId（内部ID）、projectId（授权后）、errorCode。敏感字段统一 redact；不记录密码、cookie、token、请求正文或 signed URL。**当前实现差距**：仅 requestId 已落地；route/method/status/durationMs/projectId 等为目标、尚未实现。`LOG_LEVEL` 环境变量已在 `src/server/env.ts` 中校验（枚举 debug/info/warn/error，默认 info），但当前从不被消费。上述未实现字段与日志级别消费属待补工作。

**当前限流实现为单节点进程内存令牌桶**（`src/server/modules/rate-limit/memory.ts` 的 `MemoryRateLimiter`，基于内存 Map），没有 PostgreSQL 共享计数，也未启用分布式存储；多副本部署下会失效。已落地的业务参数：常规业务写 60 次/用户/分钟（所有业务写端点共享同一用户写桶）、邀请预览/接受合计 20 次/IP/分钟（匿名端点独立桶）；认证敏感端点按 Better Auth 库内置限流（test 环境关闭、其余环境启用）。M5 上传另有独立滑动窗口：10 次/用户/分钟、跨任务最多 2 个在途请求，在接收 multipart 前准入；成功、失败、取消、超时均在 finally 释放。已准入的重放及失败请求计频率，门禁拒绝不消耗上传频率。读取 300 次/用户/分钟待 M6 实现。只信任已配置代理提供的客户端 IP（`TRUSTED_PROXY_COUNT`，默认 0 不信任转发头）。阈值为产品默认，可由配置下调，不由客户端设置。**多副本共享限流遵循既定 PostgreSQL 架构方向（非 Redis，见 docs/11 ADR-014），属 M6 部署范围，当前未实现**；多副本部署前需迁移到 PostgreSQL 共享计数。

计划提供 /health/live（进程可服务）和 /health/ready（数据库连接与迁移兼容）；不暴露版本、凭证、连接字符串。**当前两个端点尚未实现，属 M6 部署范围**。邮件/存储暂时不可用只影响对应操作，有独立可观测错误，不让整个看板持续 500。

## 9. V1.1 的扩展位置

AI 接口通过 server/integrations/ai 与 server/modules/ai-plan 接入，见 09。需要后台执行时独立 Node worker；选 PostgreSQL 作业租约，V1.1 小规模不默认引入 Redis。只有任务负载或部署需求出现明确证据，才新增队列基础设施。


---

<!-- Source: docs/04-DATA-MODEL.md -->
# 04 · 数据模型与一致性

## 1. 通用约定

业务 ID 使用 UUID；认证库的用户 ID 按其实际 schema 为字符串，业务 userId 字段与之完全同类型，不强行假设 UUID。所有事件时间为 timestamptz/UTC，网络层 ISO 8601；截止日期为 PostgreSQL date，网络层 YYYY-MM-DD。不可用浏览器本地午夜 Date 构造来回传 date-only。

字符串长度同时在 Zod 与数据库可行处限制；整数 version 默认 1。未知 JSON 字段拒绝，不批量展开请求到 ORM。所有业务表增加 createdAt；可变表增加 updatedAt。软删除表的读取默认过滤 deletedAt。

## 2. 实体关系

~~~mermaid
erDiagram
    User ||--o{ Project : owns
    User ||--o{ ProjectMember : joins
    Project ||--o{ ProjectMember : includes
    Project ||--o{ Invitation : invites
    Project ||--o{ Task : contains
    Task ||--o{ Subtask : includes
    Task ||--o{ Comment : contains
    Task ||--o{ Attachment : stores
    Project ||--o{ ActivityLog : records
    User ||--o{ Task : creates
~~~

## 3. 表与字段

### 认证表 / User

Better Auth 的 User、Session、Account、Verification 使用锁定版本的官方 schema/生成结果。User 增加 timezone（IANA，默认 Asia/Shanghai）；name 为显示名称。库要求的唯一约束、索引和关联不擅自删改。密码只由认证库放在其 Account 数据结构中；业务 API 永远不返回这些表的原始记录。

### Project

id UUID PK；ownerId User FK RESTRICT；name varchar(80)；key varchar(8) UNIQUE；description text 默认空；color 枚举 BLUE/PURPLE/TEAL/GREEN/ORANGE/GRAY；archivedAt nullable；version int 默认1；boardVersion int 默认1；nextTaskNumber int 默认1；reservedBytes bigint 默认0；usedBytes bigint 默认0；createdAt、updatedAt。

CHECK key 满足大写格式，version/boardVersion/nextTaskNumber > 0，bytes >= 0。ownerId 是唯一 owner 权限来源。key 永不复用，项目归档不释放 key。索引 ownerId,archivedAt,updatedAt,id。

### ProjectMember

id UUID PK；projectId Project FK RESTRICT；userId User FK RESTRICT；joinedAt。UNIQUE(projectId,userId)，索引(userId,projectId)。仅存非 owner 成员，无 role 字段；服务端拒绝插入 ownerId。人数=1+成员行数，最大20。

### Invitation

id UUID PK；projectId；createdById；tokenHash char(64) UNIQUE；expiresAt；revokedAt nullable；acceptedAt nullable；acceptedById nullable；createdAt。

有效条件：expiresAt>now 且 revokedAt/acceptedAt 均空。acceptedAt 与 acceptedById 同时为空或同时非空；数据库 CHECK。索引(projectId,createdAt,id)，(expiresAt)。明文 token 仅创建响应返回一次。撤销不删除历史记录。

### Task

id UUID PK；projectId；number int；creatorId User FK RESTRICT；assigneeId User FK SET NULL 可空；title varchar(120)；description text；status 枚举 TODO/IN_PROGRESS/DONE；priority 枚举 NONE/LOW/MEDIUM/HIGH；dueDate date nullable；position bigint；completedAt nullable；version int 默认1；deletedAt nullable；createdAt、updatedAt。

UNIQUE(projectId,number)，CHECK number>0、version>0、title trim非空；状态 DONE 当且仅当 completedAt 非空（包括软删除任务）。position 只在服务端处理，不作为客户端浮点数。

索引：(projectId,deletedAt,status,position,id)、(projectId,deletedAt,updatedAt,id)、(assigneeId,deletedAt,status,dueDate,id)。小规模标题搜索用参数化 ILIKE；数据达到瓶颈再评估 trigram，不默认引入搜索服务。编号搜索解析 key-number，仅查询已授权项目。

### Subtask

id UUID PK；taskId Task FK RESTRICT；title varchar(200)；isCompleted bool 默认false；version int；deletedAt nullable；createdAt、updatedAt。索引(taskId,deletedAt,createdAt,id)。显示顺序为 createdAt,id，不实现子任务重排。

### Comment

id UUID PK；taskId；authorId User FK RESTRICT；body text；version int；editedAt nullable；deletedAt nullable；createdAt、updatedAt。正文最大2000。删除时 body 清空，保留 authorId/时间；GET 返回 body=null 与 isDeleted=true。索引(taskId,createdAt,id)。新评论包含客户端幂等键，见 IdempotencyRecord。

### Attachment

id UUID PK；projectId；taskId；uploaderId；clientUploadId UUID；claimedSha256 char(64)；originalName varchar(255)；objectKey text UNIQUE；mimeType；declaredSizeBytes bigint；sizeBytes bigint nullable；sha256 char(64) nullable；state 枚举 UPLOADING/READY/FAILED/DELETED；cleanupPending bool 默认false；errorCode nullable；deletedAt nullable；createdAt、updatedAt。

UNIQUE(taskId,uploaderId,clientUploadId)防止网络重试重复上传；claimedSha256是客户端声明，sha256是服务端实际校验结果。相同uploadId的重试状态语义见05；DTO的uploadId映射clientUploadId，不输出objectKey。

projectId 必须等于父 task.projectId。数据库为 Task 增加 UNIQUE(id,projectId)，Attachment 使用 (taskId,projectId) 复合 FK，防止关联到其他项目。其他子资源不重复存 projectId，通过 task 归属授权。

READY 要求 sizeBytes>0、sha256 非空。文件大小最大10MiB；UPLOADING 预留 declaredSizeBytes，实际字节数必须与声明相符，否则失败。索引(taskId,state,createdAt,id)、(state,cleanupPending,updatedAt)。objectKey 服务端生成 projects/{projectId}/tasks/{taskId}/{attachmentId}，不含原始文件名。

### ActivityLog

id UUID PK；projectId；actorId User FK RESTRICT；entityType PROJECT/MEMBER/TASK/SUBTASK/COMMENT/ATTACHMENT；entityId text；action enum；metadata jsonb；createdAt。只追加，不编辑。

metadata 只允许任务编号、变更字段名称、枚举状态、用户ID、计数等白名单。不要存原始描述、评论、文件内容和令牌。返回 DTO 时可将 actorId 转成当前名字，已删除任务用编号显示。索引(projectId,createdAt DESC,id DESC)。具体 action 清单见 API 文档。

### IdempotencyRecord

id UUID PK；userId；method；routeKey（含真实资源ID的规范化路径）；key varchar(128)；requestHash char(64)；responseStatus int；responseBody jsonb；resourceId nullable；createdAt；expiresAt（24小时）。UNIQUE(userId,method,routeKey,key)。

仅用于事务内完成的小型 JSON 创建/恢复操作；不缓存附件二进制。认证接口使用认证库协议。重放前重新授权并检查目标资源可读，避免退出成员通过旧缓存读取。过期后 key 不再保证去重，客户端在网络不确定时应尽快查询而不是一天后重复提交。

### RateLimitBucket

keyHash PK（不存原始邮箱/IP）；windowStart；count；expiresAt。实际表与 Better Auth 数据库存储方式可分开，不能破坏库 schema。计数原子递增，维护命令清理过期桶。不以 count 的 read-then-write 实现共享限流。

## 4. 写入事务与锁

所有同项目写入先锁 Project（SELECT FOR UPDATE 或语义等价实现），再检查权限和归档状态，之后按 Task → 子资源顺序锁定。涉及owner活动项目数量的创建/归档/恢复，须先取得User锁再取得Project锁；恢复时检查10项目配额。统一顺序 User（需要时）→ Project → Task → 子资源。必须使用参数化 SQL。网络 I/O 不能位于事务内。

事务最长目标 < 1 秒，SQL 超时初始 5 秒；死锁/序列化冲突仅做有限技术重试，业务版本冲突返回409，不能自动覆盖。项目级串行写是此版本明确取舍，配并发测试后再优化。

| 操作 | 必须原子发生 |
|---|---|
| 创建任务 | 检查配额、取并递增 nextTaskNumber、插入任务、递增 boardVersion、写活动、写幂等记录 |
| 编辑任务 | 校验成员、expectedVersion、负责人归属，更新字段/version，必要时排序与 boardVersion，写活动 |
| 移动任务 | 校验 expectedVersion/expectedBoardVersion、位置计算、状态/completedAt/version、boardVersion、活动 |
| 删除/恢复任务 | 权限、version、deletedAt、恢复时任务数量上限、恢复排序、boardVersion、活动 |
| 接受邀请 | 项目锁、令牌状态、人数检查、成员插入、邀请消费、活动 |
| 移除成员 | 删除成员关系、清空其全部任务负责人（包括软删除任务）、受影响 version++、活动 |
| 评论/子任务写入 | 对象权限、自己的 version、数据修改、父任务 updatedAt、活动 |
| 附件预留 | 任务/项目配额检查、UPLOADING 行、reservedBytes 增加 |
| 附件完成 | 重新授权、READY、reservedBytes 减少、usedBytes 增加、活动 |

项目资料修改递增 Project.version；boardVersion 专管看板成员/顺序集合。成员退出导致任务卡负责人变化，刷新查询即可，不需要递增 boardVersion；task.version 必须增加。任务删除、恢复也必须递增task.version。普通字段规范化后没有语义变化时不更新version和活动；一次PATCH即使修改多个字段也只增加一次version。

## 5. 看板排序算法

每列按 (position,id) 排序，position 初始间隔1024。创建任务追加列尾；空列 position=1024。move 请求给出目标状态和 beforeTaskId；null 表示列尾。服务端从完整列读取邻居，不信任客户端 position。beforeTaskId 不能是自身、不能跨项目、必须属于目标列且未删除。

在前后邻居之间取整数中点；插首时取首项-1024（允许负数）；插尾取末项+1024。如无整数间隙或会超出 bigint 范围，在同一项目锁事务内对目标列按1024重新编号，再计算插入值。内部重编号不改变展示顺序，其他任务 version 不因此增加；本次移动任务 version 增加，boardVersion 增加。

move 带 expectedVersion 与 expectedBoardVersion。任一不匹配返回409，附 currentVersion/currentBoardVersion。无语义变化的 move 直接返回当前任务，不额外写活动和增加版本。PATCH 修改 status 统一复用移动服务，追加目标列末尾；PATCH 本身不接受 position。

创建、跨/同列移动、删除、恢复都会改变 boardVersion。看板读取使用一致快照（REPEATABLE READ 短只读事务）获取列数据、总数与 boardVersion；不能三次独立读取拼接不同时刻的数据。

## 6. 配额与文件一致性

项目锁内计数并检查配额。文件预算条件 usedBytes+reservedBytes+declaredSizeBytes<=200MiB。子任务/任务/成员等上限同样在锁内判断，不能只靠前端。

软删除任务仍占用附件空间，恢复不需要重新上传。删除附件先把数据库状态变 DELETED 并扣 usedBytes，再尝试删除对象；失败保留 cleanupPending。过期 UPLOADING 清理扣 reservedBytes。清理命令重复运行不重复扣减，所有计数保持非负。

未通过验证的上传不会产生 FILE_UPLOADED 活动；成功后才记。上传期间权限丢失则失败并清理。对象存储与数据库不可能共享事务，必须依靠状态与补偿实现最终一致性。

## 7. 迁移与种子数据

所有 schema 变更生成迁移并审阅 SQL；生产只运行 migrate deploy，不运行 migrate dev/db push。SQL 中约束、索引、复合 FK 都须纳入迁移。

种子数据只允许明确的开发/测试数据库，脚本验证 APP_ENV 与库名并提供目标信息；不输出凭证。不通过删全库实现 seed：使用稳定 fixture ID/upsert，只修改 fixture 范围。测试清库仅限独立测试实例/指定 schema。

fixture 的 now 是可注入基准时间，日期相对基准生成，以便覆盖昨天/今天/未来/无日期/跨时区。不用多年后失效的硬编码“今天”。V1 不需要 AI 表，后续在09新增迁移。


## 2026-09-11 · M5 协议冲突关闭

附件 uploadId 保持 UUID；内部 DELETED + deletedAt 同步，公开 DTO 不返回 DELETED。下载端点保持 Download JSON，url 为 60 秒有效且绑定当前用户的应用签名链接。GET /attachments/{attachmentId}/content 校验签名、当前会话、当前项目成员、父任务未删除和附件 READY 后代理私有 S3 流，强制 attachment、private,no-store；不向客户端暴露 objectKey。该选择取代先前签名存储 URL 与直接二进制响应混用的实现。

上传先持久预留，再有界流接收至私有临时文件并校验实际内容/大小/摘要、流写 S3，最后独立事务复核权限并提交 READY。请求总时限 120 秒；临时文件请求结束删除。维护命令 cleanup:attachments 处理一小时以上失效上传及 cleanupPending 对象；FAILED/DELETED 的待删标志保留至少 3 分钟，让取消中的 PUT 结束后再物理删除。对象删除失败保留待重试标志，已清理对象不重复释放配额。

附件 task 关系在 Prisma 中显式映射 (taskId, projectId) → Task(id, projectId)。20260911093000 仅移除被复合外键覆盖的冗余单列外键；保留跨项目保护和既有 CHECK，避免后续迁移误删手写复合外键。


## 2026-09-11 事件时间与删除缓存修订

事件时间（包括认证表）使用 `@db.Timestamptz(3)`，截止日 `dueDate` 继续使用 `@db.Date`。既有 TIMESTAMP 列按原应用 UTC 语义显式 `AT TIME ZONE 'UTC'` 转换，不依据执行迁移时的会话时区猜测。迁移前核对旧数据来源和默认时区，并比较转换前后的归一化数据指纹。

锁定的 adapter-pg 7.10.0 时间解析器假定 PostgreSQL 返回 UTC 文本，应用连接必须固定 `timezone=UTC`；业务代码不得更改池连接时区。时区回归分别核对数据库 epoch 和恢复 UTC 会话后的 Prisma Date，用户时区仅用于展示及 date-only 筛选。认证 API 继续接收相同的 JavaScript Date。

删除评论的事务同步将其创建幂等响应改为删除占位；旧数据迁移清除已删除评论残留的缓存正文。请求摘要和幂等标识继续保留，但不能再返回已删除正文。


---

<!-- Source: docs/05-API-CONTRACT.md -->
# 05 · API 契约与语义

## 1. 范围与维护

机器可读的 V1 业务协议见 [openapi.json](contracts/openapi.json)，OpenAPI 3.1，基路径 /api/v1。认证库挂在 /api/auth/*，遵循锁定 Better Auth 版本的协议，不伪造业务包装。健康检查 /health/live、/health/ready 也不使用业务包装。AI 扩展单独见09，V1 不暴露未实现 AI 路由。

开发时将契约实现为 src/contracts 的 Zod schemas/DTO，并添加契约测试。OpenAPI、运行时 schema 和业务规则必须同步；禁止只有类型声明而没有服务端校验。

## 2. 通用约定

- JSON camelCase；日期时间 UTC ISO 8601；date-only 为 YYYY-MM-DD。
- 业务 ID 是 UUID，userId 是认证库字符串 ID。
- 成功：{data: ..., meta:{requestId}}；列表 meta 增加 nextCursor（可空）、hasMore。
- 错误：{error:{code,message,fieldErrors?,currentVersion?,currentBoardVersion?},meta:{requestId}}。
- 对象响应只返回 DTO 白名单；不输出密码、会话、tokenHash、objectKey、内部堆栈。
- 私有响应 Cache-Control: private, no-store；Vary 按框架配置正确处理 Cookie。
- 201 表示新建成功，200 表示读取/更新/幂等重放结果；204 仅用于无返回值操作。
- PATCH 接受显式字段，缺失表示不改，null 仅在字段允许清空时有效。至少有一个可修改字段。
- 客户端只提交 expectedVersion，不能自行写 version、createdAt、completedAt、creatorId 或 position。
- 所有自有非 GET API 检查 Origin；匿名邀请预览也包含此要求。

## 3. 错误码

| HTTP | code | 行为 |
|---|---|---|
| 400 | VALIDATION_ERROR / INVALID_CURSOR | 字段旁提示；不重试 |
| 401 | UNAUTHENTICATED | 登录并保留合法 returnTo |
| 403 | FORBIDDEN / EMAIL_UNVERIFIED / ORIGIN_NOT_ALLOWED | 显示访问限制 |
| 404 | NOT_FOUND | 不区分不存在和非成员不可见 |
| 409 | VERSION_CONFLICT / BOARD_CONFLICT | 保留草稿/回滚，重新获取 |
| 409 | PROJECT_KEY_TAKEN / PROJECT_ARCHIVED | 项目字段冲突或只读 |
| 409 | INVITATION_USED / ALREADY_EXISTS / IDEMPOTENCY_CONFLICT / UPLOAD_IN_PROGRESS / LOCKED | 按具体业务处理 |
| 410 | INVITATION_EXPIRED / INVITATION_REVOKED | 显示邀请失效 |
| 413 | PAYLOAD_TOO_LARGE | 拒绝请求并提示 |
| 415 | UNSUPPORTED_FILE_TYPE | 不支持的文件格式 |
| 422 | LIMIT_EXCEEDED / ASSIGNEE_NOT_MEMBER / INVALID_BOARD_TARGET | 配额超限或权限不匹配 |
| 429 | RATE_LIMITED | 限流提示，带 Retry-After |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
| 503 | STORAGE_UNAVAILABLE / SERVICE_UNAVAILABLE | 服务暂时不可用 |

错误 message 给普通用户看；代码供程序分支判断。违反方法/内容类型等框架级错误可在入口转换。不能用 200 携带 error 假装成功。

## 4. 权限入口与子资源

GET /tasks/{taskId} 先定位最小 projectId，再验证当前成员关系和 deletedAt，之后返回内容。所有 comment/subtask/attachment 接口通过 task 的真实归属授权，不能仅验证客户端传来的 projectId。

ProjectDTO.role 是计算得到的 OWNER/MEMBER，不写回数据库。ProjectMemberDTO 返回 userId、name、role、joinedAt，不向队友披露 email。接口不开放全站用户搜索；负责人从项目成员列表选择。

删除与更新操作在事务中重新验证权限，防止“检查之后成员被移除”的竞争。重放幂等响应也必须先验证当前可见性。

## 5. 幂等与并发

需要 Idempotency-Key 的操作：创建项目、创建任务、创建邀请、创建子任务、发布评论、恢复任务。客户端为一次逻辑操作生成 UUID；网络重试复用相同 key 和 body；用户主动新建使用新 key。

服务端按 userId+method+routeKey+key 唯一，保存规范化请求 SHA-256 与响应，24小时有效。同 key 同内容返回原始业务结果与状态码，可附 Idempotency-Replayed:true；不同内容返回409 IDEMPOTENCY_CONFLICT。创建项目没有 Project 锁，使用用户级事务锁或等价并发控制保护项目数量与幂等记录；之后项目写使用 Project 行锁。

邀请明文 token 的创建响应需要重试可取回，但数据库规则禁止保存明文。该接口的幂等记录仅保存邀请 ID 与状态：首次201返回token，重放200返回同邀请元数据且 token=null，提示“链接仅首次展示，可撤销后重新生成”。不能将邀请 token 放进 IdempotencyRecord.responseBody。评论创建重放须优先检查当前删除状态：已删除时返回 200 和当前删除占位（body=null、isDeleted=true），删除事务同步清除创建幂等缓存正文；该规则优先于原响应重放。其余接口按原响应重放。业务 UUID 在构造 routeKey 前统一为小写，大小写等价路径共享同一幂等命名空间。

接受邀请依靠 tokenHash 唯一与 acceptedById 实现业务幂等，不要求 Idempotency-Key。更新/移动使用 expectedVersion；DELETE 子资源/任务使用 query expectedVersion。恢复任务 body 带 expectedVersion，与 key 一起工作。 恢复的首次执行要求任务已删除；同 key 同 body 的已完成恢复，在重新检查当前权限且目标仍可读后重放原结果。创建/恢复的缓存不得绕过当前软删除状态返回任务正文。

Comment、Subtask 自己维护 version。正文编辑与父任务标量字段冲突独立；父任务 updatedAt 因讨论发生变化，但 version 不因此增加。

## 6. 分页与列表

列表采用游标分页，默认30/上限100；评论按 createdAt,id 升序，活动按 createdAt,id 降序。项目/任务默认 updatedAt,id 降序。优先级排序 HIGH→MEDIUM→LOW→NONE；截止日空值排尾。游标必须携带排序字段和id，绑定过滤指纹；服务端校验类型与当前过滤，不把游标当授权证明。

任务列表用 TaskSummary，不包含大段 description；详情 TaskDTO 才包含 description。deleted=only 返回回收站摘要，普通结果 deletedAt=null。分页期间发生更新可能导致列表跨页重复，客户端按 id 去重；不承诺列表的跨请求数据库快照。

看板初次 GET /projects/{id}/board 返回三列及同快照 boardVersion，每列最多limit（默认50）；status+cursor 用于后续加载单列。看板 cursor 必须携带原 boardVersion；版本改变返回409 BOARD_CONFLICT，客户端清空已拼接列并重新获取，避免在过时分页上拖拽。

筛选 q（最多100字）、status、priority、assigneeId、unassigned、overdue；assigneeId 与 unassigned=true 互斥。我的任务可跨当前参与项目，并固定当前用户为负责人；服务端按会话过滤，客户端不能指定任意 userId。

## 7. 示例

邀请列表 `GET /projects/{projectId}/invitations` 仅 owner 可访问，支持 cursor/limit（默认30，上限100），按 createdAt,id 降序。游标绑定项目，响应为 Invitation[] 与 PageMeta；归档后仍可读，永不返回 token/tokenHash。页面的服务端直查不代替该 HTTP 契约。

邀请预览遇到网络失败、429 或 5xx 时，客户端保留本标签页的令牌并提供重试；刷新仍可恢复预览。仅确认不存在、已过期、已撤销、已使用或接受成功后清除。令牌继续通过片段进入页面、通过 POST 请求体传输，不改用 query 参数。

创建任务 POST /projects/{projectId}/tasks，Idempotency-Key: UUID。

~~~json
{
  "title": "完成活动详情页",
  "description": "展示时间、地点与剩余名额。",
  "status": "TODO",
  "priority": "HIGH",
  "assigneeId": null,
  "dueDate": "2026-10-12"
}
~~~

更新任务 PATCH /tasks/{taskId}：

~~~json
{"expectedVersion": 3, "title": "完善活动详情页与空状态", "dueDate": null}
~~~

移动任务 POST /tasks/{taskId}/move：

~~~json
{"expectedVersion": 4, "expectedBoardVersion": 12, "toStatus": "IN_PROGRESS", "beforeTaskId": null}
~~~

move 成功 data 为 {task:TaskDTO,boardVersion:13}。错误示例：

~~~json
{
  "error": {"code": "VERSION_CONFLICT", "message": "这条任务已被更新，你的输入已保留。", "currentVersion": 5},
  "meta": {"requestId": "req_example"}
}
~~~

这些是说明格式的合成数据，不是已实现或真实测量结果。

## 8. 文件上传协议

POST /tasks/{id}/attachments 使用 multipart/form-data：uploadId（客户端 UUID）、declaredSizeBytes、sha256（客户端计算的内容摘要）、file。客户端按此顺序追加，file最后；服务端在收到文件流前完成元信息校验与配额预留，元信息缺失/顺序不合法返回400。服务端重新计算摘要，不能信任客户端结果。file MIME/名称从 multipart 元数据取得，按上传规则验证。空文件拒绝；单次上传总时限120秒；元信息区最大64KiB。

Attachment 增加 clientUploadId、claimedSha256；UNIQUE(taskId,uploaderId,clientUploadId)。相同 uploadId 同元信息：READY 返回既有附件200，UPLOADING 返回409 UPLOAD_IN_PROGRESS，FAILED/DELETED 返回409并要求新的 uploadId；元信息或内容摘要不同返回409 IDEMPOTENCY_CONFLICT。这样网络超时重传不创建第二个附件。

前端通过 XHR 或支持 upload progress 的客户端获取真实上传进度，不伪造百分比。成功201/重放200返回 AttachmentDTO；列表返回全部UPLOADING/READY及最近5条FAILED供界面恢复，DELETED不返回，因此列表最多10条。下载端点返回 {url,expiresAt,fileName}，先重新鉴权，再按需导航下载。signed URL 不进入持久日志。

## 9. 活动动作

PROJECT_CREATED、PROJECT_UPDATED、PROJECT_ARCHIVED、PROJECT_RESTORED、MEMBER_JOINED、MEMBER_LEFT、MEMBER_REMOVED、TASK_CREATED、TASK_UPDATED、TASK_MOVED、TASK_DELETED、TASK_RESTORED、SUBTASK_CREATED、SUBTASK_UPDATED、SUBTASK_DELETED、COMMENT_CREATED、COMMENT_UPDATED、COMMENT_DELETED、FILE_UPLOADED、FILE_DELETED。

邀请创建/撤销只在邀请列表显示，V1 不额外加入活动枚举；不得记录其 token。重复无变化更新不产生事件。一次用户操作只产生清晰的一条主要事件，成员退出的批量取消分配用 metadata.count 表达。

## 10. 契约验收

- 所有业务 endpoint 的 method/path/operationId 与 OpenAPI 一致。
- 请求/响应通过 schema，错误也有统一结构。
- 业务 JSON payload 最大64KiB（附件接口另设上限），过大请求在完整解析前拒绝。
- 合法/非法输入、权限、409、分页边界和幂等至少覆盖关键接口。
- 文件上传、认证回调和空body204不能误用统一 JSON 解析器。


## 2026-09-11 · M5 协议冲突关闭

附件 uploadId 保持 UUID；内部 DELETED + deletedAt 同步，公开 DTO 不返回 DELETED。下载端点保持 Download JSON，url 为 60 秒有效且绑定当前用户的应用签名链接。GET /attachments/{attachmentId}/content 校验签名、当前会话、当前项目成员、父任务未删除和附件 READY 后代理私有 S3 流，强制 attachment、private,no-store；不向客户端暴露 objectKey。该选择取代先前签名存储 URL 与直接二进制响应混用的实现。

上传先持久预留，再有界流接收至私有临时文件并校验实际内容/大小/摘要、流写 S3，最后独立事务复核权限并提交 READY。请求总时限 120 秒；临时文件请求结束删除。维护命令 cleanup:attachments 处理一小时以上失效上传及 cleanupPending 对象；FAILED/DELETED 的待删标志保留至少 3 分钟，让取消中的 PUT 结束后再物理删除。对象删除失败保留待重试标志，已清理对象不重复释放配额。


---

<!-- Source: docs/06-IMPLEMENTATION-PLAN.md -->
# 06 · 分阶段开发计划

## 执行方式

一次只推进一个里程碑。每个阶段完成后必须能运行并展示新增的实际流程，更新任务状态和证据。文档中的“完成”均要求实际验收，不能以生成了文件、页面能打开或测试被跳过来代替。

预估 V1 100—144 小时，不含额外学习和20%缓冲；V1.1另加16—24小时。任务机器版本见 [backlog.json](planning/backlog.json)。所有任务初始 todo，依赖决定是否可开始。

## M0 · 项目基线与规格实现（10—14小时）

**输入**：00、01、02、03、OpenAPI。

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-001 | 初始化 Next/TS/pnpm；检查版本；创建环境样例、基础脚本、Compose（PostgreSQL/MinIO/Mailpit）、.gitignore；记录 versions.md | 安装、lint、typecheck、build；开发环境可启动；空数据库可连接 |
| ORB-002 | 实现 tokens、基础控件、AppShell 与三个核心页面的布局样例；使用明确的fixture | 三种视口截图；按钮/弹层键盘操作；fixture不冒充真实保存 |
| ORB-003 | 创建请求/响应DTO、错误码、校验帮助函数、API客户端、契约测试骨架；对照OpenAPI | schema正反例；服务端模块不进入客户端bundle；合同引用检查 |

**完成条件**：README 的本地准备步骤可信；版本实际锁定；设计不是临时拼凑；没有真实业务时明确样例状态。未来测试脚本可以先只覆盖已实现范围，不允许永久用 exit 0 的空脚本假装完整测试。

## M1 · 认证和个人设置（14—20小时）

**输入**：认证库官方版本文档、01账户、04认证schema、08环境。

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-004 | Better Auth及数据库适配、认证迁移、会话查询、Origin边界、请求ID/错误基础设施、测试隔离 | 本地迁移可重复部署；数据库会话/失效测试；没有凭证输出 |
| ORB-005 | 注册、验证、登录、退出、找回/重设密码；接Mailpit；合法returnTo | 浏览器真实收本地邮件并验证；未验证受限；重设后旧会话失效；auth限流 |
| ORB-006 | /me接口、姓名/时区设置、个人菜单、私有缓存清理 | 修改刷新后保留；非法时区拒绝；退出/换账号不泄露缓存 |

**完成条件**：两个独立账户可用，邮件通过真实本地SMTP联调。测试可调用认证库官方server API建立夹具会话，不新增公开“测试登录后门”。

## M2 · 项目与任务纵向闭环（18—24小时）

**输入**：01权限/任务、04数据、05接口。

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-007 | Project/Member/Activity/Idempotency基础迁移；项目创建/读取/更新/归档；授权服务、项目写事务和活动写入器 | 非成员404；key冲突；项目数量并发限制；owner权限；归档只读 |
| ORB-008 | Task迁移与CRUD、任务详情/编辑器、负责人校验、version、编号、软删除恢复、回收站 | 刷新持久化；编号唯一；旧version409；删除恢复；幂等创建 |
| ORB-009 | 核心服务集成和API契约测试；种子项目/任务；完善错误映射 | AC-02/04/05/10对应测试；真实数据库回滚；任务字段白名单 |

**完成条件**：登录→创建项目→创建任务→编辑状态→刷新→回收站恢复可完整演示。活动事件从此阶段随业务事务写入，M4只补前端展示，不允许后补伪造历史日志。

## M3 · 列表、看板与编辑体验（14—20小时）

**输入**：02页面、03缓存、04排序、05分页。

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-010 | 任务列表、筛选URL、游标分页、任务详情侧面板/独立链接、空状态 | 刷新保留筛选；详情关闭回原上下文；越权task参数不可读 |
| ORB-011 | 同快照看板、每列加载更多、dnd排序、移动API、菜单替代、乐观回滚 | AC-06；并发move冲突；重编号保持顺序；分页变更409；不完整视图禁拖拽 |
| ORB-012 | 编辑草稿保护、409冲突UI、后台刷新、键盘与手机流程 | 双浏览器修改不覆盖；失败保留输入；390px主流程可用 |

**完成条件**：拖拽不是只改前端数组；无网络时失败回滚且界面可恢复；键盘可改状态；真实1000任务fixture下看板分页仍可用。

## M4 · 团队成员与活动（14—20小时）

**输入**：01邀请/退出、04并发、05 token与权限。

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-013 | 邀请创建、一次显示、复制、预览、接受、失效/撤销页面 | AC-03；原token不入DB/日志；两用户竞争；幂等token重放例外 |
| ORB-014 | 成员列表、owner移除、member退出、取消任务分配、二次授权 | AC-09；移除与分配并发；owner不可退出；缓存失效 |
| ORB-015 | 活动列表/分页、项目设置与归档操作完整UI、审阅既有事件 | 事件与业务同事务；归档例外准确；无重复空更新事件 |

**完成条件**：两个浏览器用两个真实账户完成邀请协作与退出。不能仅靠演示fixtures模拟多人权限。

## M5 · 任务协作、附件和工作台（14—22小时）

**输入**：01相关功能、02详情/工作台、04文件状态、05上传。

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-016 | 子任务清单及version、计数与父状态独立 | 上限50；并发修改409；完成父任务不自动勾子任务 |
| ORB-017 | 评论创建编辑删除、分页、幂等、作者/owner权限 | 重复提交不重复；删除清正文；脚本文本不执行 |
| ORB-018 | 私有附件上传/下载/删除、配额、真实进度、失败补偿、维护脚本 | AC-08文件项；类型/大小/权限检查；重复uploadId；上传中移除；孤儿清理 |
| ORB-019 | 我的任务与四类计数、时区日期、跨项目查询；补齐详情与卡片计数 | AC-07；无日期/归档/删除排除；午夜边界；按实际负责人筛选 |

**完成条件**：详情页中的所有可见操作都可用；MinIO真实上传下载联调通过；失败/超限可恢复。附件成本比预期高时优先调整工期，不能用公开目录代替私有授权存储。

## M6 · 发布、验证与求职材料（16—24小时）

**输入**：07、08、13。

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-020 | 完成测试矩阵、视觉/无障碍检查、1000任务性能测量、缺陷修复 | AC-01—11；CI无跳过关键项；所有指标附环境与结果 |
| ORB-021 | Docker生产构建、托管依赖、迁移步骤、日志/限流、私有存储、备份恢复 | AC-12；HTTPS双账户冒烟；数据库备份在隔离环境恢复；邮件域配置 |
| ORB-022 | 只读demo、介绍页真实截图、英文README、架构/取舍记录、演示脚本与报告 | 陌生访问者3分钟可理解；无共享写入账号；所有数字有证据 |

**完成条件**：V1可发布。若外部域名/生产服务凭证未提供，交付本地可复现版本和待配置清单，任务保持待验收状态，不能谎称已上线。

## M7 · AI 拆解助手 V1.1（16—24小时，独立范围）

| 任务 | 工作与产物 | 必须通过 |
|---|---|---|
| ORB-023 | 按09补AI schema/契约、provider adapter、受限输入输出和评测fixture | 无key下mock联调；结构/引用/日期/配额校验 |
| ORB-024 | 持久作业、worker租约、超时、有限重试、成本记录 | 进程重启可恢复；取消生效；单job不重复提交结果 |
| ORB-025 | 计划预览/编辑/勾选/导入、导入幂等、真实provider验证与评测报告 | 不自动创建未确认任务；同计划只导入一次；20样本评测 |

V1.1须得到明确开发指令后执行；本轮项目规划包含设计，不触发真实API或购买服务。

## 阶段报告模板

交付报告必须包含：完成任务ID、行为变化、关键文件、迁移/API变更、运行命令与结果、截图位置、已知缺口、下一任务。不需要复述所有操作日志。验收失败先修复当前阶段，除非用户明确要求带着已知问题推进。


---

<!-- Source: docs/07-QUALITY-AND-TESTING.md -->
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


---

<!-- Source: docs/08-ENVIRONMENT-AND-DEPLOYMENT.md -->
# 08 · 环境、CI 与部署

## 1. 本地开发目标

仓库根为 Orbit。M0提供 package.json、锁文件、Docker Compose 和实际启动文档。这些运行文件已实现；下列命令与 package.json 对齐，实际验证结果以 PROGRESS.md 为准。

环境要求：Node.js24 LTS、pnpm兼容稳定版本、Docker/Compose（或等价独立PostgreSQL、MinIO、Mailpit）。不自动假设用户安装了Docker；M0先检查，缺少时说明具体安装/启动步骤，仍可完成独立的规格与UI工作。

推荐本地端口：应用3000、PostgreSQL5432、MinIO API9000/控制台9001、Mailpit SMTP 宿主25025→容器1025/Web8025。只绑定localhost。Mailpit SMTP 宿主端口用25025而非1025：Windows 动态/临时端口区间（约1024–15000）会随机占用1025导致bind失败；`.env.local`/`.env.example` 的 SMTP_PORT 须与宿主端口一致（25025），容器内Mailpit始终监听1025（`compose.dev.yml` 映射 `${MAILPIT_SMTP_HOST_PORT:-25025}:1025`）。测试使用独立数据库orbit_test和独立对象前缀，不复用orbit_dev的数据（`pnpm test:e2e` 的具体实现见本节下方「E2E 测试环境隔离」）。

~~~text
pnpm install --frozen-lockfile
docker compose -f infra/compose.dev.yml up -d
pnpm db:migrate:dev
pnpm db:seed
pnpm dev
~~~

首次锁文件尚不存在时，M0使用正常安装生成锁文件；之后CI固定 frozen-lockfile。用户复制.env.example为.env.local并填写本地值。Prisma CLI、seed、维护脚本须显式加载同一约定环境文件，不能只有Next能读.env.local而CLI读不到。不同脚本不得静默回落到生产数据库。

## 2. 预定脚本

| 命令 | 责任 |
|---|---|
| pnpm dev | 启动开发web |
| pnpm build / start | 构建/运行生产web |
| pnpm lint / typecheck | ESLint与TS严格检查，lint使用独立CLI |
| pnpm test:unit | 纯逻辑与组件必要测试 |
| pnpm test:contract | OpenAPI/Zod/业务响应契约 |
| pnpm test:integration | 独立PostgreSQL上的API/事务/权限测试 |
| pnpm test:e2e | Playwright核心流程，仅启动独立测试服务，禁止复用 |
| pnpm check | lint、typecheck、unit、contract；integration/e2e在CI另执行 |
| pnpm db:migrate:dev | 仅开发库创建/应用迁移 |
| pnpm db:migrate:deploy | 按环境应用已审阅迁移 |
| pnpm db:seed | 幂等写入开发fixture |
| pnpm cleanup:attachments | M5 已实现：限批处理失效上传与待删除附件，失败可重试 |
| pnpm maintenance:cleanup | M6 待实现：统一清理过期幂等记录/限流桶等 |
| pnpm worker:ai | M7才提供的持久AI任务worker |

开发Agent负责让名称和实际行为一致。如果使用不同命令，同步README/AGENTS/CI，不能只改package.json。

### E2E 测试环境隔离（A10，2026-09-10）

`pnpm test:e2e` 不再直接 `next build && next start`（会加载 `.env.local` 的
`DATABASE_URL`，指向开发库 orbit_dev）。当前实现：

1. `playwright.config.ts` 的 `webServer.command` 改为
   `pnpm run build && node scripts/e2e-server.mjs`；应用端口默认 `E2E_PORT=3100`
   （与开发服务器默认的 3000 分开，防止 Playwright 静默复用一个正在跑的开发
   服务器）；`reuseExistingServer` 固定为 `false`（从不静默复用）。
2. `scripts/e2e-server.mjs` 在真正 spawn `next start` 前做三项前置校验，任一失败
   立即非零退出、不启动：`TEST_DATABASE_URL` 必须指向本机且数据库名与
   `DATABASE_URL`（开发库）不同名；实际连接该库确认可达且 `_prisma_migrations`
   已有完成记录（防止指向一个从未迁移的空库）；目标端口必须空闲（防止「端口
   已被占用」被误判为「服务已就绪」）。通过后把
   `DATABASE_URL`/`TEST_DATABASE_URL`/`APP_URL`/`BETTER_AUTH_URL`/
   `AUTH_TRUSTED_ORIGINS`/`PORT`/`APP_ENV=test` 作为**子进程环境变量**传给
   `next start`——按 Next.js 官方文档的加载顺序（process.env 优先于
   `.env.local`），子进程全程连接 orbit_test，从不触碰 orbit_dev。
3. 启动后不只看 stdout 的 "Ready" 字样（那只代表 HTTP 监听已打开，不代表应用
   运行时通过了自己的环境校验）：脚本轮询 `GET /api/v1/me` 直到收到 401（该端点
   在无 cookie 时的唯一预期响应）才打印 `E2E_SERVER_READY`；超时或子进程提前
   退出都判定启动失败并终止该子进程树。
4. `src/server/env.ts` 的「测试库不得与开发库同名」校验为此新增一个精确、窄范围
   的例外：仅当 `APP_ENV=test` 且 `DATABASE_URL` 与 `TEST_DATABASE_URL`
   **逐字节完全相同**时放行——这精确对应上一步子进程覆写后的形状，不会放行
   「两个连接串数据库名恰好相同但其余部分不同」这类更可能是误配置的场景；
   开发/生产库名黑名单（`NON_TEST_DB_PATTERN`）在该例外下仍无条件生效。
5. `E2E_BASE_URL` 外部服务复用已禁用：预检查脚本和 Playwright 配置均直接拒绝。
   E2E/UI 使用 runner 管理的独立服务，`reuseExistingServer: false`，不通过请求头
   指纹推断未知服务使用哪个数据库。
6. 所有 E2E spec 文件的数据库直连与清理统一经 `tests/e2e/support/db.ts`：
   `withTestDb()` 独立再校验一次「测试库与开发库不同名」（与
   `e2e-server.mjs` 的检查互为纵深防御），`cleanupTestEmails(emails)` 按精确
   邮箱集合、FK 安全顺序（ActivityLog→IdempotencyRecord→Invitation→Task→
   ProjectMember→Project→User→Verification）删除，对不存在的邮箱是安全空操作，
   不做任何范围扩大的清理，失败时抛出异常而不是吞掉。
7. `pnpm test:ui` 继承相同的隔离配置、夹具清理和 global teardown。
   默认先生产构建，再启动 3100 端口的独立测试服务；显式 `E2E_SERVER_MODE=dev`
   也只改变构建模式，不改变数据库隔离。两套测试结束后均核对开发库和测试库
   所有 public 表的内容指纹，残留、误删或其他内容变化均使命令失败。

历史维护脚本：`cleanup-migration.ts` 已停用，不能重放删除迁移历史或 DROP 操作。
`cleanup-invitation-tokens.ts` 默认仅输出候选数量；执行变更需同时传
`--apply --database=<精确数据库名>`。更新在事务内完成，失败返回非零状态且不输出
驱动错误原文。它识别旧参数化路径及当前真实项目路径，不输出令牌值。

## 3. 环境变量

| 名称 | 作用 / 校验 |
|---|---|
| APP_ENV | development/test/staging/production，显式枚举 |
| APP_URL | 完整同源地址，生产HTTPS |
| DATABASE_URL | 正确环境的连接串，客户端不可见 |
| TEST_DATABASE_URL | 独立测试库，测试拒绝生产/开发库名 |
| BETTER_AUTH_URL | 与APP_URL和回调配置一致 |
| BETTER_AUTH_SECRET | 通过安全随机生成；不提交；测试与生产不同 |
| AUTH_TRUSTED_ORIGINS | 精确来源列表，不使用通配符放开 |
| SMTP_HOST/PORT/USER/PASSWORD/SECURE | 认证邮件传输配置 |
| MAIL_FROM | 已验证生产发件身份，本地可用orbit.local |
| STORAGE_ENDPOINT/REGION/BUCKET | S3兼容地址与私有bucket |
| STORAGE_ACCESS_KEY_ID/SECRET_ACCESS_KEY | 仅限本桶操作的服务端凭证 |
| STORAGE_FORCE_PATH_STYLE | 本地MinIO需要时true，按生产供应商配置 |
| LOG_LEVEL | 脱敏日志级别，生产默认info |
| AI_ENABLED | V1默认false；false时不要求AI变量 |
| AI_PROVIDER/AI_MODEL/AI_API_KEY | M7才使用，凭证仅服务端 |
| AI_DAILY_REQUEST_LIMIT | M7用户每日运行次数限制，默认10 |

用Zod等在服务启动时校验必需项，错误只展示变量名和预期格式，不回显值。不要将秘密变量加NEXT_PUBLIC前缀。客户端只需要由服务端提供的非敏感公开配置。

生产认证要求邮箱验证和可靠重置流程；SMTP未配置时不能把验证永久关闭来标记发布成功。本地Mailpit不是生产邮件服务。

## 4. 生产部署基线

首版采用持续运行的Node容器，部署到用户选择的容器托管平台或服务器，配托管PostgreSQL、私有S3兼容存储和邮件服务。供应商最终选择涉及账户/费用，在需要配置时处理；规划不假设已经购买或授权访问任何平台。

构建：多阶段Dockerfile、锁定Node基础镜像主版本与可复现digest、安装冻结依赖、生成Prisma Client、Next standalone构建、最小运行层、非root用户。浏览器上传流经Node服务，入口限制约12MiB请求体并在应用层对实际文件限制10MiB。

数据库与web尽量同区域，使用可信TLS，设置有限连接池（起点每实例5连接，结合实际数据库上限调整）。应用水平扩展时会话/幂等/限流来自数据库，不能依赖单机内存保存关键状态。

## 5. 发布顺序

1. CI完成所有当前版本检查，生成标识明确的镜像。
2. staging配置与生产分离，使用合成数据，验证迁移与冒烟。
3. 备份当前数据库，记录恢复点；首次空库也记录迁移版本。
4. 运行一次 migrate deploy。迁移不能在每个容器启动时并发执行。
5. 部署应用，等待ready健康检查；验证登录、任务写入、评论、私有上传下载。
6. 检查错误率、数据库连接和存储权限；记录发布版本及结果。

采用向前兼容迁移：先加字段/表→兼容代码→回填→确认稳定后再移除旧结构。V1少数据也保持此习惯。应用回滚至兼容镜像；数据库不通过盲目down migration回滚。不可兼容变更必须有具体备份恢复方案。

## 6. 维护、备份与恢复

维护任务由部署平台的定时任务每日执行一次，处理过期幂等记录、限流桶、1小时以上失效上传和cleanupPending对象；本规划不创建真实定时任务。函数本身幂等、限批量、记录处理数量和错误，不输出敏感key。

数据库每日备份，初始保留7天；附件存储开启适用的版本/备份机制并配置成本可控的保留策略。项目文件引用和实际对象都要能恢复，不能只备份数据库。V1不自动清空回收站。

至少在隔离环境做一次数据库+样例附件恢复演练：验证成员关系、任务版本、评论、文件下载与活动。记录实际恢复耗时与可能的数据窗口。目标RPO≤24小时、RTO≤2小时，仅是初始目标，实测后填写结果。

## 7. 故障处理

- 数据库不可用：ready失败；业务503；不缓存“保存成功”。
- 对象存储不可用：上传/下载局部错误；已保存任务仍可用；补偿任务可重跑。
- 邮件失败：允许重发并限流，页面不泄露账户存在性；日志含脱敏错误码。
- 版本冲突高：检查前端轮询、local队列和project锁耗时，不直接移除version校验。
- 测试误连非测试库：脚本立即失败，不自动清库。
- 生产凭证缺失：保持对应发布任务待验收，提供变量名清单和已完成的本地证据。

## 8. 发布报告

报告位置 artifacts/release/：提交/镜像/迁移版本、CI链接、部署时间与环境、实际冒烟、性能测量、恢复演练、已知限制。不要填预期分数或虚构在线人数。

### M5 附件与迁移运维验收（2026-09-11）

`pnpm cleanup:attachments` 显式加载 .env.local/.env，通过 react-server 条件运行 server-only 业务模块；一次最多 100 条，打印 cleanedCount、failedCount、releasedBytes，不输出对象 key。错误返回非零退出码。UPLOADING 超过一小时释放预留；FAILED/DELETED 等待至少 3 分钟后物理删除，防止与取消中的 PUT 竞争。幂等重跑不会重复扣额度。真实定时调度仍属 M6，当前未配置。

当前 11 个迁移均可从空库部署；uploadId 是 UUID，Attachment 的 task 关系是复合外键。中断遗留迁移会话可能持有 advisory lock；先核验持锁连接是否空闲、无事务及其来源，再处理旧迁移等待者与持锁者，不关闭迁移锁机制、不删除迁移历史。Windows 的 EACCES 端口错误可通过设置已确认可绑定的 E2E_PORT 避开；本轮使用 43127。

### 全项目审查修复后的运行约定（2026-09-11）

上述 11 迁移为 M5 历史验收；本轮新增事件时间 timestamptz 转换和已删除评论缓存清理，共 13 个迁移。先核对旧 TIMESTAMP 的 UTC 语义，再执行增量部署；详情见 [本轮迁移与验收记录](docs/reviews/REVIEW-FIXES-2026-09-11.md)。应用连接固定 UTC，以满足当前 adapter-pg 7.10.0 的时间解析约定，date-only 截止日不变。

认证与业务端点统一按 `TRUSTED_PROXY_COUNT` 选择转发链中的来源；默认 0 忽略客户端提供的转发头并使用共享桶。大于 0 仅适用于受控代理正确追加/清洗头且源站禁止直接访问的部署。

附件集合端点不经过 Next Proxy，避免 Proxy 在路由准入之前缓冲请求体；会话、Origin、资源授权、通用写桶与上传专用门禁仍在路由/服务端执行。上传 10 次/用户/分钟、最多 2 条在途请求为单进程限制，多副本共享准入仍须在 M6 按 PostgreSQL 方案完成。


---

<!-- Source: docs/09-AI-ASSISTANT-V1.1.md -->
# 09 · AI 项目拆解助手（V1.1，可独立交付）

## 1. 定位与前置条件

V1完整验收后再实现，使用M7。功能是受控的结构化AI助手：根据项目目标给出任务草案，用户编辑并选择后导入。没有实现自主工具规划时，不在简历中把单次生成包装成自主多Agent系统。

没有AI Key时V1所有功能正常。开发可先使用明确标记的fixture provider；真实API联调需要有效凭证与配置，不能把mock输出作为真实模型评测。此文档不指定最新模型或价格，接入阶段查官方资料并记录实际provider/model版本。

## 2. 用户流程

项目页增加“AI拆解”入口 → 输入目标与约束 → 显示将发送的资料范围 → 生成 → 可离开后返回查看 → 预览/编辑/删除/勾选建议 → 确认创建正式任务 → 跳转项目任务列表。

默认只发送用户本次输入、项目名称、目标截止日期和匿名化角色描述。加入既有任务标题是明确可选项，最多50条；不默认发送评论、附件、邮箱、token或其他项目数据。界面说明资料会发送给所配置的模型服务，用户发起生成是该次发送动作。

输入：goal 20—5000字符，constraints 0—2000，targetDate可空，taskCount 5—20，includeExistingTasks默认false。目标日期不得早于用户今天。只允许项目当前成员在未归档项目生成。

## 3. 输出契约与验证

~~~json
{
  "summary": "建议先完成报名闭环，再补齐管理和异常处理。",
  "assumptions": ["先交付桌面Web版本"],
  "tasks": [
    {
      "key": "T1",
      "title": "定义活动与报名数据结构",
      "description": "明确活动信息、报名记录与人数限制。",
      "acceptanceCriteria": ["重复报名被拒绝", "剩余名额计算准确"],
      "priority": "HIGH",
      "suggestedDueDate": null,
      "order": 1
    }
  ]
}
~~~

key唯一；title≤120；description≤6000；acceptanceCriteria为1—5条、每条≤300；枚举与V1一致；最多20任务；日期必须合法并在用户给定范围内。模型不写数据库ID、负责人ID、权限或任务状态。服务端为每条建议分配稳定candidateId UUID，默认负责人空、状态TODO。

不把模型文本直接当HTML；所有结果通过schema校验。结构不合格允许一次受限修正调用，两次仍失败则显示失败。UI允许用户修改所有草案字段；未知字段拒绝。验收条件导入时合并为任务description中的固定Markdown清单，不改V1 Task表增加模糊的JSON字段。

## 4. 持久作业与状态

新增 AiPlan：id、projectId、requestedById、inputJson、resultJson、status、version、provider、model、attempts、leaseOwner、leaseUntil、cancelRequestedAt、errorCode、inputTokens/outputTokens、estimatedCost nullable、importHash、importedTaskIds、createdAt/startedAt/finishedAt。

状态：QUEUED → RUNNING → DRAFT_READY / FAILED / CANCELLED；DRAFT_READY → IMPORTED。重新生成创建新记录，不覆盖已经审核过的计划。取消仅作用QUEUED/RUNNING；结果已到但用户取消时丢弃最终结果并记取消。

独立Node worker用PostgreSQL领取作业（FOR UPDATE SKIP LOCKED或等价机制），60秒租约、15秒续租。不要持数据库事务进行模型调用。worker重启可领取过期租约，提交时检查leaseOwner和状态，旧worker不能覆盖新结果。每job最多2次执行尝试；单次调用设置60秒超时，job总时限约180秒。

数据库提交可保证只接受一次结果，不能保证外部模型只计费一次：进程在收到响应后崩溃仍可能重试。供应商支持幂等才额外使用；否则记录这个边界，避免无限重试。

同一用户同一项目最多1个QUEUED/RUNNING；每用户每天默认最多10次新建，失败也占用次数以防滥用；模型最大输出token由配置限制。成本只有按实际用量与已验证价格表才能估算，不知道价格时显示用量并将cost置空。

## 5. 拟新增接口（M7先扩充OpenAPI）

| 方法与路径 | 语义 |
|---|---|
| POST /projects/{id}/ai-plans | 202返回planId；Idempotency-Key；保存后排队 |
| GET /projects/{id}/ai-plans | 仅当前用户创建的计划列表 |
| GET /ai-plans/{id} | 申请者且仍是项目成员才能读取状态/草案 |
| PATCH /ai-plans/{id} | DRAFT_READY时编辑；expectedVersion |
| POST /ai-plans/{id}/cancel | 请求取消，幂等 |
| POST /ai-plans/{id}/import | candidateIds+expectedVersion+Idempotency-Key；确认后导入 |

V1.1计划内容只对创建者可见，导入的正式任务按项目共享。owner不因身份自动获得别人私有草案读取权；将来若需要团队共享计划，单独设计。

## 6. 导入一致性

导入事务按Project→AiPlan锁顺序；重新验证当前成员、项目未归档、plan归属、DRAFT_READY、version、选中candidate存在且不重复、任务配额。一次导入1—20个候选。

用户可以在UI选择负责人，提交时必须仍为项目成员；失效返回422，让用户修正。默认空，不让模型猜负责人。所有正式任务的编号、创建者、时间由服务器分配；写任务/活动/递增boardVersion/标记IMPORTED在同一事务完成。

一个plan只允许一次导入（可选部分）；未选项留作历史，不能之后再补导入。记录导入请求指纹及任务ID：同请求重试返回原任务ID，不同选择再次导入返回409。需要另一批任务应复制/重新生成新计划。避免“用户点两次创建，任务翻倍”。

## 7. 前端状态

显示排队/生成/校验/就绪/失败的实际状态与已耗时间，不展示虚构思维链或假百分比。浏览器可见时2秒轮询，终态停止；离开页面不丢作业。错误展示重试（新计划）和取消入口，保留输入。计划预览用可编辑任务列表，不另造大型聊天界面。

## 8. 评测

准备20个合成需求：清晰、模糊、过大范围、不合理截止、重复工作、长输入、注入式文本、已有任务重复等，保存在tests/fixtures/ai/。记录provider/model/promptVersion/输入输出/判分理由，敏感真实资料不进入fixtures。

目标：至少19/20在允许的一次修正后得到合格结构；所有成功导入100%通过业务约束；人工按具体性、可执行性、验收可验证性各1—5评分并记录分布。阈值是上线目标，未达成先优化或如实标注实验功能，不改测试掩盖失败。

还需测试worker崩溃恢复、重复导入、取消、成员被移除、项目归档、限流、无key功能关闭。结果可用于说明AI编程/应用能力，但不要声称未经实现的自主Agent能力。


---

<!-- Source: docs/10-AGENT-HANDOFF.md -->
# 10 · Agent 与 AI IDE 交接规范

## 1. 入口

以整个Orbit目录作为工作区。支持AGENTS.md的工具直接读取；其他工具手动提供AGENTS.md和当前任务涉及文件。规则不是依赖某个模型记住对话，需求和状态都在仓库中。

继续开发使用 [CONTINUE](prompts/CONTINUE.md)。换Agent使用 [HANDOFF](prompts/HANDOFF.md)。审查使用 [REVIEW](prompts/REVIEW.md)。

## 2. 开发循环

1. 读取状态、依赖和相关规格，确认当前任务的输入输出。
2. 写简短实现方案，列出需要修改的契约、表、页面与验收条件。
3. 对复杂行为使用 [功能规格模板](templates/FEATURE-SPEC.md)，普通样式修复无需重复写大文档。
4. 先走通一条真实垂直流程，再补充失败和边界状态。
5. 跑与改动相关的测试、静态检查和浏览器验证，修复失败。
6. 更新任务status/evidence和PROGRESS，输出简洁可复核的交接。

任务状态：todo → in_progress → review → done；blocked只用于缺少外部配置/明确依赖导致无法完成，不因普通bug而使用。done必须有验收证据；review表示实现完成但待检查。

## 3. 需求变更

用户明确提出新行为时，分析01/02/04/05/OpenAPI/测试的受影响项，更新文档再实现；较大的取舍写 [决策模板](templates/DECISION.md)。常规实现选择无需反复请示，按已定默认执行并记录。

遇到规格内部冲突：报告具体文件与规则，提出最小一致修正；能在用户已授权范围内判断时直接修正文档并说明，不停在“有冲突”不处理。不要通过临时接口绕过数据不变量。

新特性不自动加入当前V1。收录到后续清单，除非用户要求更改范围。尤其不要在核心任务尚未完成时自行加AI聊天、支付、即时通信或自定义看板。

## 4. 多Agent时的分工（仅在用户要求时使用）

用户可以将不同阶段交给不同Agent，不需要同一模型全程完成。如明确同时安排多个Agent，先由负责人冻结接口/数据约定并分配文件边界。

适合独立工作的范围：设计组件/页面、领域服务与迁移、契约测试/集成测试。共享的schema、OpenAPI、根配置、锁文件需单一负责人；他人提变更请求，不并行覆盖。用独立分支/worktree并在合并后统一跑集成检查。

不要在同一工作区让两个Agent同时写同一迁移编号或更新同一个锁文件。不要并行开发有未冻结契约的前端和后端再靠临时字段拼接。

## 5. 交接最小材料

- 当前分支与提交（如仓库已初始化）以及用户未提交改动。
- 已完成任务ID、相关PR/commit/主要文件。
- 数据库当前迁移版本；是否需要运行迁移。
- 实际验证命令、结果、证据路径。
- 未完成边界与已知缺陷，不写模糊的“基本完成”。
- 下一项依赖已满足的任务，具体到ID和验收条件。
- 外部配置缺口只列变量名/服务名，不传递秘密。

## 6. Review关注点

先查错误权限/数据丢失/并发/异常，再查性能、无障碍和可维护性。每个问题给出触发条件、影响、文件位置和建议；不为风格偏好生成一大串低价值问题。

变更涉及任务写入：核对version、boardVersion、锁、幂等和活动原子性。涉及附件：核对流量/类型/配额/补偿/私有访问。涉及UI：核对状态和缓存，不只看成功截图。涉及AI：核对输入范围、后台状态与用户确认后的导入。

## 7. Agent常见偏差与纠正

| 偏差 | 纠正 |
|---|---|
| 用localStorage模拟全部后端 | 仅demo允许fixture；正式路径使用真实服务与数据库 |
| 为通过测试删掉权限/校验 | 修复实现或不正确的测试前提，保留业务规则 |
| 一次生成整个应用但没运行 | 按里程碑交付真实闭环 |
| 前端与后端使用不同字段名 | 以OpenAPI/DTO为准并同步变更 |
| 拖拽只有本地排序 | 保存位置/版本，验证刷新与冲突 |
| 忽略注册邮件与忘记密码 | 完整做M1，生产用可用邮件服务 |
| 共享一个可写演示账号 | 使用只读隔离fixture演示 |
| 把所有新库都设latest | M0验证并锁定，变更写决策 |
| 伪造性能分数/用户规模 | 只报告实际测量与样本限制 |

本文件为项目开发约定，不能覆盖用户最新授权范围或工具/平台权限规则。


## 8. 文档维护

README 负责导航，PROGRESS 只记录当前状态、实际验收、限制与下一步；backlog
维护任务状态和有效 evidence，不嵌套保存整轮旧审查。产品规则、数据不变量和架构
取舍更新到专题文档及 ADR，避免只留在一次性报告中。

结论报告集中在 docs/reviews，每次收尾维护清楚的当前验收入口，不再在根目录或
artifacts 复制多份“完成报告”。已被覆盖且无独立价值的分析/交接材料可以清理，
同时修复其链接与 evidence。原始测试证据独立保存，不把失败日志改写成成功。


---

<!-- Source: docs/11-DECISIONS-AND-RISKS.md -->
# 11 · 已定决策、假设与风险

## 已定技术决策

| ID | 决策 | 理由与代价 |
|---|---|---|
| ADR-001 | Next.js模块化单体，同源REST | 减少跨域与重复部署；服务层仍可独立测试，未来可拆 |
| ADR-002 | 用户直接加入项目，无workspace | 对学生团队足够；后续企业组织功能需迁移设计 |
| ADR-003 | Owner/Member两种角色 | 权限可验证；owner不能转让/退出是明确V1边界 |
| ADR-004 | 邮箱密码认证交给Better Auth | 减少自写认证风险；需要实际邮箱验证和邮件服务 |
| ADR-005 | PostgreSQL+Prisma7，必要约束写SQL | 类型和迁移便于维护；不能仅靠ORM模型表达所有不变量 |
| ADR-006 | 项目行锁+资源version | 小团队下优先正确性；同项目写吞吐有限，需测量 |
| ADR-007 | bigint间隔排序+boardVersion | 可处理稳定顺序与冲突；看板分页过时必须重取 |
| ADR-008 | 三列固定状态 | 易懂可交付；自定义状态以后单独设计 |
| ADR-009 | 描述Markdown、评论纯文本 | 可保存技术内容且安全面可控；不做复杂富文本共同编辑 |
| ADR-010 | 持续运行Node+私有S3服务端上传 | 便于流式校验与配额；相较直传增加服务端带宽 |
| ADR-011 | 30秒轮询+乐观更新，无WebSocket | 实现成本可控；不宣称实时同步 |
| ADR-012 | 明文邀请token只返回一次 | 数据库不保存可用邀请秘密；网络丢响应时需重新生成 |
| ADR-013 | 软删除任务，项目仅归档 | 可恢复且逻辑简单；删除数据占用空间需清晰显示 |
| ADR-014 | 无全局状态库/搜索引擎/Redis | 当前规模可由局部状态、数据库解决；有测量证据再加 |
| ADR-015 | V1.1独立AI助手、审核后导入 | 基础产品不受API Key/质量影响；AI交付单独验收 |
| ADR-016 | 只读demo与真实账户隔离 | 访客可立即体验；不能在demo验证真实写流程 |
| ADR-017 | M2/M3 统一用「Server props（force-dynamic）+ 直接 createApiClient() 调用 + router.refresh()」单一真源模式，不引入 TanStack Query | M2 已验证此模式闭环真实编辑与持久化；M3 看板/列表页仍维持 props 为唯一数据真源，避免 hooks 产生第二套缓存导致不一致（R5 审查第 3 节明确要求）。若未来轮询/乐观更新复杂度上升，可再引入 React Query 作为客户端交互的局部优化（initialData 来自 server props），但必须满足“无两套冲突的请求/缓存实现”约束。当前删除孤儿 hooks（features/tasks/hooks、features/projects/hooks）+ 移除未使用的 react-query providers 是正确实践。 |
| ADR-018 | Task子资源计数M2返回常量0 | subtask/comment/attachment表M5才建，提前COUNT无对象；DTO字段形状与openapi.json一致，M5建表后改真实计数不改契约 |
| ADR-019 | 幂等重放前必须重新授权 | Idempotency-Key命中已存响应时先重跑会话+成员资格检查再返回缓存结果；防止成员被移除后用旧键重放拿到数据；代价是重放多一次授权查询 |
| ADR-020 | /auth/*路由前缀偏离docs/02的扁平路由（M1决策，M2补录） | 分组前缀便于proxy matcher按段区分认证页与受保护页；公开资料与导航链接需同步用/auth/* |
| ADR-021 | 页面目录[id]命名沿用M0（API层用[projectId]/[taskId]） | 前端路由M0已建/app/projects/[id]/*且UI回归覆盖，改名无行为收益；API路由段名与openapi.json路径参数一致更重要 |
| ADR-022 | M2/M3 分阶段交付详情与看板（已完成） | ORB-008验收面是任务生命周期 API 与真实编辑闭环；M2真实编辑落在任务列表页行内交互，详情/看板页的完整真实数据化属ORB-010/011范围；M3 已完成真实详情与看板；仅 samples 路径保留明确标记的样例 |
| ADR-023 | 5张业务表对User.id全ON DELETE RESTRICT | 业务数据完整性优先于删除便利性；未来用户注销走匿名化（改写归属列）而非硬删除，V1不提供自助注销 |

如果用户已熟悉独立后端框架，可以将服务层迁至NestJS/FastAPI，但需作为架构变更处理：明确API部署、认证cookie/CORS、类型同步与运维成本。本规划默认不双栈实现相同业务。

## 默认假设

- 单人开发，React与基础后端知识可边做边补。
- 每项目上限20人、1000任务，初始目标为作品展示与小规模试用。
- 当前本地库已有开发与测试数据；迁移与清理必须保留既有数据，不按空库处理。无第三方系统集成要求。
- 可以使用Docker或等价本地服务；不能使用时由M0记录替代部署。
- 生产服务预算和账号尚未指定，因此不承诺特定供应商、免费额度或价格。
- 产品名称为工作名称，公开运营前可再检查域名/品牌可用性；开发无需因命名停顿。

## 主要风险

| 风险 | 早期信号 | 对应处理 |
|---|---|---|
| 范围膨胀 | M2前开始聊天/日历/AI | 回到当前验收条件，新增放V1.2清单 |
| 只会生成代码不会排错 | 脚本未跑、堆ts-ignore | 每阶段真实运行，记录关键问题与修正 |
| 多人数据覆盖 | 刷新丢失编辑、排序反弹 | version、boardVersion和竞争测试 |
| 越权访问 | 改URL可读别的任务 | 子资源归属授权、非成员测试 |
| 附件泄露/账目错误 | 公开桶、失败占空间不回收 | 私有下载、上传状态机、清理补偿 |
| 认证联调晚 | 最后一周才配验证邮件 | M1用Mailpit闭环，M6单独验证生产邮件 |
| 审美后补 | 每页各自样式、无空状态 | M0先tokens与3页布局，持续截图对照 |
| 依赖版本混用 | Prisma/认证示例与安装不符 | M0版本记录，按对应官方版本文档实现 |
| 性能空泛 | 只说快没有环境和报告 | M6固定fixture、重复测量、附限制 |
| AI错误/外部成本 | 无结构输出、无限重试 | V1.1限次/限时/校验/人工审核 |

## 后续功能候选（不属于本次V1验收）

任务标签、日历视图、项目模板、owner转让、通知收件箱、历史变更diff、GitHub issue关联。只有真实试用反馈或用户明确选择后再排期。实时协作/付费订阅/原生App需独立规划。


---

<!-- Source: docs/12-REFERENCES.md -->
# 12 · 官方资料与使用边界

核对日期：2026-09-08。下列用于解释技术选择与提醒版本差异；产品业务规则是Orbit自己的设计，并非这些资料的结论。实现时阅读与实际锁定版本一致的官方文档，不能直接复制检索摘要。

| 主题 | 官方来源 | 本项目使用点 |
|---|---|---|
| Agent仓库指令 | [OpenAI AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | AGENTS.md作短入口，按任务读取详细规格；其他IDE手动附加 |
| Next安装 | [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) | M0核对runtime与React兼容条件 |
| Server/Client边界 | [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 数据与秘密在server，交互局部client以减少客户端JS |
| Node支持周期 | [Node.js releases](https://nodejs.org/en/about/previous-releases) | 本规划选Node24 LTS，并非追逐Current版本 |
| Better Auth集成 | [Next.js integration](https://better-auth.com/docs/integrations/next) | 使用认证库官方Next接入方式 |
| 邮箱密码/验证/重置 | [Email & Password](https://better-auth.com/docs/authentication/email-password) | 邮件回调和验证逻辑按锁定版本实现 |
| Prisma runtime | [System requirements](https://docs.prisma.io/docs/orm/reference/system-requirements) | 核对Node/TS/系统环境 |
| Prisma7迁移差异 | [Upgrade to Prisma ORM 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7) | ESM、生成器、adapter与配置差异；不要混用旧版示例 |
| 客户端数据流 | [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 实际采用 RSC 直查 + router.refresh（非 TanStack Query）；服务器组件为数据真源，写后刷新 |
| 数据库锁 | [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) | 项目写锁与统一锁顺序；实现时选择17版本页面 |
| CSRF | [OWASP CSRF](https://owasp.org/www-community/attacks/csrf) | 自有变更API同源检查，认证路由遵循库机制 |
| 文件上传 | [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | 类型、大小、文件名、私有存储和最小权限 |
| 可访问性 | [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) | 颜色对比、键盘、焦点与控件可用性 |
| Web指标 | [Web Vitals](https://web.dev/articles/vitals) | LCP/INP/CLS与真实用户第75百分位；区分实验室测试 |
| AI复杂度取舍 | [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) | 从简单受控流程开始，按需要增加自主性 |

本规划没有验证任何生产服务免费额度、当前价格或用户账号权限。M0版本兼容验证、M6部署和M7模型接入时分别补充实际信息。

建议保留2—3篇简短英文技术决策，引用实际使用的官方段落并解释本项目为什么采用该方法。避免复制整页文档；重点写自己遇到的问题、做过的实验与取舍。


---

<!-- Source: docs/13-DEMO-AND-PORTFOLIO.md -->
# 13 · 演示、试用与求职材料

## 1. 两类演示环境

公开/demo：只读合成数据，访客无需注册，明确标注“演示数据”；不查询真实私有项目。可以切换视图、筛选、看详情和活动，写操作提示注册。演示页面与真实组件复用，数据源独立。

真实功能演示：在staging使用两个本人控制的测试账户，走真实服务与数据库。不要公开共享可写账号；测试账户凭证不写仓库或演示视频。公开demo证明体验，真实演示证明业务，两者分别描述。

## 2. Fixture方案

项目A：校园活动报名系统，key CAMP，owner小林，member小周、小陈。约24任务，三列有数量差异，覆盖高/中/低优先级、昨天/今天/未来7天/无截止、未分配、长标题、子任务、评论和附件样例。

项目B：个人作品集，key PORT，个人项目约12任务。

项目C：已结束课程设计，key COURSE，归档，约8任务。

另备权限测试专用项目D，由账户B拥有，A不是成员。另生成性能数据集每项目1000任务，每任务合理数量子任务和评论；按稳定随机种子生成，不混入公开demo。

日期基于可注入now相对生成；测试用固定clock。公开demo中的“今天”相对当前浏览器日期显示，仅用于fixture；真实产品按服务器的用户时区计算。

所有附件为自行生成无敏感信息的样例PDF/图片/文本，不从用户电脑随机收集文件。种子数据不含现实人物私人联系方式。

## 3. 3分钟主演示路线

| 时间 | 操作 | 说明 |
|---|---|---|
| 0:00—0:20 | 打开工作台 | 面向学生小团队，今天有哪些任务 |
| 0:20—0:50 | 新建任务并分配、设置日期 | 真实业务、输入校验和持久化 |
| 0:50—1:20 | 看板拖拽、打开详情 | 界面层级、状态变化和流畅反馈 |
| 1:20—1:45 | 子任务、评论与私有附件 | 任务上下文里的协作 |
| 1:45—2:10 | 第二账户接受邀请并参与 | 服务端权限与多人流程 |
| 2:10—2:35 | 展示一次受控冲突/失败回滚 | 数据可靠性，不是只演示成功 |
| 2:35—3:00 | 展示部署与测试报告 | 自己的技术取舍和验证证据 |

AI完成后可加一段独立60秒演示：输入目标→生成草案→编辑→选择导入→不会重复创建。没有实现时不在主视频假装存在。

## 4. 仓库材料

- 英文README：what/why、截图、demo、local setup、architecture、testing、trade-offs、limitations。
- 一张架构图与数据关系图，保持与实际代码一致。
- 关键规格样例：拖拽排序、成员退出、附件上传等1—2项。
- 2—3篇短技术决策：项目锁与version、私有附件补偿、前端缓存与冲突。
- 实际测试/性能报告、CI结果、发布记录。
- 合理的commit/PR记录：按功能解释问题与行为，不为制造历史伪造提交。

## 5. 简历描述模板

仅在对应功能完成后使用，例如：

“独立开发并部署Orbit项目协作平台，基于Next.js、TypeScript和PostgreSQL实现项目权限、任务看板、评论与私有附件；通过版本校验、事务和幂等处理解决多人编辑与重复提交问题。”

第二条填实际证据：“在[明确测试环境/数据集]下将[具体指标]从[实测A]改善到[实测B]，并以[实际测试数量/流程]覆盖权限隔离、并发冲突和失败恢复。”

不能将计划数字、模拟用户或fixture任务量写成真实运营规模。AI辅助开发可以如实说明：自己负责规格、数据建模、关键决策、审查与验证，能解释实现而不只是接受生成结果。

## 6. 面试准备

能够回答：为什么选择此架构；权限在哪验证；成员被移除时正在上传怎么办；两人同时拖拽会怎样；如何避免重复任务；如何测性能；哪些规则来自你的规格；AI生成代码曾出现什么错误以及如何发现和修复。

试用记录每条包含用户目标、卡住位置、实际行为、修正与验证。不要求用户赞美产品，也不虚构反馈。优先处理会阻断主流程的真实问题。


---
