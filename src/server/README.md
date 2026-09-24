# 服务端业务层

本层处理凭证、认证、数据库、存储和授权，禁止进入客户端 bundle。

- db：Prisma 与 PostgreSQL adapter、事务、连接错误。
- auth：Better Auth、会话、验证邮件与 SMTP。
- modules：项目、任务、成员、邀请、评论、附件、工作台及维护服务。
- http：请求校验、Origin、错误映射、日志与限流入口。
- me：个人资料与时区。
- services：成员服务入口。

env.ts 校验运行环境。项目资源在服务端校验会话、成员关系、资源归属与写权限。详见 [架构](../../docs/03-ARCHITECTURE.md)。
