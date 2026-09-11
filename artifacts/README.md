# artifacts · 原始验收证据

保存实际运行产生的日志、截图、trace 和数据指纹。当前 M0–M4 验收证据在
`m0-m4-fixes-20260911/`，对应 [最新验收报告](../docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md)。

旧运行的日志、截图与探针保留用于追溯，不代表当前状态；重复的分析和完成报告已清理。
`documentation-cleanup-20260911/removed-files.json` 记录此次清理的文件清单。

- 当前状态只在 PROGRESS.md / backlog 维护，结论报告集中在 docs/reviews。
- 必要回归进入正式 tests，不依赖本目录的临时探针。
- 原始产物默认被 Git 忽略；不提交凭证、令牌或用户附件。
- 日志中的失败如实保留，最终是否通过取决于对应命令退出状态和清理检查。
