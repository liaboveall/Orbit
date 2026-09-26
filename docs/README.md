# 开发文档

应用介绍与本地启动见 [README](../README.md)。当前状态以 [PROGRESS](../PROGRESS.md) 和 [backlog](../planning/backlog.json) 为准。

## 产品与实现

| 文档 | 内容 |
| --- | --- |
| [执行总览](00-EXECUTION-OVERVIEW.md) | 产品边界与完成定义 |
| [产品规格](01-PRODUCT-SPEC.md) | 功能、权限与验收 |
| [交互与设计](02-UX-AND-DESIGN.md) | 页面、视觉变量与无障碍 |
| [架构](03-ARCHITECTURE.md) | 分层、数据流与技术边界 |
| [数据模型](04-DATA-MODEL.md) | 字段、不变量与事务 |
| [API 语义](05-API-CONTRACT.md) / [OpenAPI](../contracts/openapi.json) | 网络行为与传输结构 |
| [实施计划](06-IMPLEMENTATION-PLAN.md) | 里程碑与依赖 |
| [质量与测试](07-QUALITY-AND-TESTING.md) / [测试操作](../tests/README.md) | 验收标准与运行方式 |

## 运行与维护

- [环境、CI 与部署](08-ENVIRONMENT-AND-DEPLOYMENT.md)
- [Oracle Cloud 部署指南](OCI-DEPLOYMENT.md)（当前目标）/ [AWS 部署指南](AWS-MICRO-DEPLOYMENT.md)（备选）/ [运行手册](M6-OPERATIONS.md)
- [版本记录](versions.md) / [官方资料](12-REFERENCES.md)
- [决策与风险](11-DECISIONS-AND-RISKS.md)

## 状态与后续开发

- [当前实现与交付边界](CURRENT-STATUS.md) / [开放事项](../planning/open-items.json) / [最近验证摘要](../planning/verification.json)
- [AI 助手规划（未实现）](09-AI-ASSISTANT-V1.1.md)
- [Agent 工作约定](../AGENTS.md) / [交接流程](10-AGENT-HANDOFF.md)
- [演示与作品集](13-DEMO-AND-PORTFOLIO.md)
- [变更与升级检查清单](14-CHANGE-AND-UPGRADE-CHECKLIST.md)

旧报告、重复审计台账与开发日志从当前目录移除；需追溯时查看 Git 历史。文档链接、OpenAPI 结构和任务依赖检查：`python planning/validate_plan.py --check`，不替代应用测试。
