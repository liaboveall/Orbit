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
- [AWS 部署指南](AWS-MICRO-DEPLOYMENT.md) / [运行手册](M6-OPERATIONS.md)
- [版本记录](versions.md) / [官方资料](12-REFERENCES.md)
- [决策与风险](11-DECISIONS-AND-RISKS.md)

## 后续开发与历史

- [2026-09-18 本地修复与交付记录](reviews/REWORK-CLOSURE-2026-09-18.md) / [可复验的证据摘要](reviews/evidence/REWORK-20260918.json)（当前入口；历史及外部阻塞明确保留）
- [2026-09-18 全面完善交付独立验收：需返工](reviews/IMPROVEMENT-ACCEPTANCE-2026-09-18.md) / [开放验收问题](../planning/improvement-acceptance-2026-09-18.json)
- [2026-09-18 审查复核与完善任务书](reviews/REVIEW-ANALYSIS-2026-09-18.md) / [配套 Agent 执行指令](../prompts/AGENT-IMPROVEMENT-2026-09-18.md)（历史任务资料，现以本轮交付记录为准）
- [AI 助手规划（未实现）](09-AI-ASSISTANT-V1.1.md)
- [Agent 工作约定](../AGENTS.md) / [交接流程](10-AGENT-HANDOFF.md)
- [演示与作品集](13-DEMO-AND-PORTFOLIO.md)
- [开发历史](DEVELOPMENT-HISTORY.md)
- [最近本地返工验收](reviews/REMEDIATION-REWORK-CLOSURE-2026-09-13.md) / [待补齐的事件证据](reviews/TEST-DATA-INCIDENT-2026-09-13.md)

`reviews/`、审计台账与 PROGRESS 中的旧记录是历史证据，不代表当前待执行指令。带日期的修复 prompt 仅供追溯；继续开发应先读当前状态。

重复汇总的 `DEVELOPMENT-PLAN.md` 及规划打包工具已于 2026-09-13 移除，请直接维护专题源文档。旧验收报告对它们的引用描述的是当时执行的操作，可通过 Git 历史查询。

检查文档链接、OpenAPI 结构和任务依赖：`python planning/validate_plan.py`。结果写入 [VALIDATION](../planning/VALIDATION.md)，不替代应用测试。

- [业务变更、框架升级与性能验收清单](14-CHANGE-AND-UPGRADE-CHECKLIST.md)
