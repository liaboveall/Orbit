# 12 · 官方资料与使用边界

核对日期：2026-09-08。下列用于解释技术选择与提醒版本差异；产品业务规则是Orbit自己的设计，并非这些资料的结论。实现时阅读与实际锁定版本一致的官方文档，不能直接复制检索摘要。

| 主题 | 官方来源 | 本项目使用点 |
|---|---|---|
| Agent仓库指令 | [AGENTS.md 社区规范](https://agents.md/) | AGENTS.md作短入口，按任务读取详细规格；其他IDE手动附加 |
| Next安装 | [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) | M0核对runtime与React兼容条件 |
| Server/Client边界 | [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 数据与秘密在server，交互局部client以减少客户端JS |
| Node支持周期 | [Node.js releases](https://nodejs.org/en/about/previous-releases) | 本规划选Node24 LTS，并非追逐Current版本 |
| Better Auth集成 | [Next.js integration](https://better-auth.com/docs/integrations/next) | 使用认证库官方Next接入方式 |
| 邮箱密码/验证/重置 | [Email & Password](https://better-auth.com/docs/authentication/email-password) | 邮件回调和验证逻辑按锁定版本实现 |
| Prisma runtime | [System requirements](https://docs.prisma.io/docs/orm/reference/system-requirements) | 核对Node/TS/系统环境 |
| Prisma7迁移差异 | [Upgrade to Prisma ORM 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7) | ESM、生成器、adapter与配置差异；不要混用旧版示例 |
| SMTP发送预算 | [Nodemailer SMTP](https://nodemailer.com/smtp/) | connectionTimeout/greetingTimeout/socketTimeout 与 requireTLS 语义；默认超时不能当作请求预算 |
| 客户端数据流 | [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 实际采用 RSC 直查 + router.refresh（非 TanStack Query）；服务器组件为数据真源，写后刷新 |
| 数据库锁 | [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) | 项目写锁与统一锁顺序；实现时选择17版本页面 |
| CSRF | [OWASP CSRF](https://owasp.org/www-community/attacks/csrf) | 自有变更API同源检查，认证路由遵循库机制 |
| 文件上传 | [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | 类型、大小、文件名、私有存储和最小权限 |
| 可访问性 | [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) | 颜色对比、键盘、焦点与控件可用性 |
| Web指标 | [Web Vitals](https://web.dev/articles/vitals) | LCP/INP/CLS与真实用户第75百分位；区分实验室测试 |
| AI复杂度取舍 | [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) | 从简单受控流程开始，按需要增加自主性 |

本规划没有验证任何生产服务免费额度、当前价格或用户账号权限。M0版本兼容验证、M6部署和M7模型接入时分别补充实际信息。

建议保留2—3篇简短英文技术决策，引用实际使用的官方段落并解释本项目为什么采用该方法。避免复制整页文档；重点写自己遇到的问题、做过的实验与取舍。
