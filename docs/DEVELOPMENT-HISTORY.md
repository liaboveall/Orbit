# 开发历史与 GitHub 归档说明

仓库：[liaboveall/Orbit](https://github.com/liaboveall/Orbit)（私有）。主分支为 `main`；`archive/snapshot-*` 标签保存恢复出的开发快照。

## 历史真实性与边界

2026-09-11 首次发布前，本地 `master` 尚无初始提交，分支引用、标签与 reflog 均为空。`git fsck --full --no-reflogs` 找到 15 个未被引用的 tree 对象，它们保留了真实的历史文件内容，但没有原始提交的作者、时间或父子关系。

本次将每个原始 tree 原样封装为独立的恢复提交，并使用归档标签永久引用；恢复提交使用当前导入时间，没有回填日期，也没有猜测快照间的先后关系。下表按 tree 哈希排列，**不代表开发顺序**。主分支从当前已验收代码建立正式基线；后续开发按正常 Git 提交记录。

这保留了本地目前可恢复的全部 15 份 Git 快照，以及当前源码、13 项数据库迁移、规划、交接、历次审查与修复记录。不能据此声称恢复了从第一行代码开始的原始提交历史；没有留下的中间版本无法补造。旧快照中的完成声明、测试结果与缺陷均是当时记录，不是当前验收结论。

## 开发过程阅读入口

- 当前状态和累计交接：[PROGRESS](../PROGRESS.md)、[backlog](../planning/backlog.json)。
- 产品与实施规划：[执行总览](00-EXECUTION-OVERVIEW.md)、[专题文档索引](README.md)。
- M0–M4 审查与准入：[独立审查](https://github.com/liaboveall/Orbit/blob/archive/snapshot-775af6e23ddf/docs/reviews/M0-M4-INDEPENDENT-AUDIT-2026-09-11.md)、[修复关闭](reviews/M0-M4-FIX-CLOSURE-2026-09-11.md)。
- M5 深入审查：[审查报告](reviews/M5-DEEP-REVIEW-2026-09-11.md)。
- 全项目审查与最后修复：[问题清单](reviews/PROJECT-DEEP-REVIEW-2026-09-11.md)、[R01–R09 修复验收](reviews/REVIEW-FIXES-2026-09-11.md)。
- 机器可核验的原始 tree、恢复 commit、标签与文件数：[归档清单](history/recovered-snapshots.json)。

## 恢复快照索引

| GitHub 快照 | 文件数 | 当时 PROGRESS 中的状态标题 |
| --- | ---: | --- |
| [10555e0d7baa](https://github.com/liaboveall/Orbit/tree/archive/snapshot-10555e0d7baa) | 439 | 2026-09-11 — 中断后独立深入审查（当前最新状态） |
| [39c34ad5f1a0](https://github.com/liaboveall/Orbit/tree/archive/snapshot-39c34ad5f1a0) | 425 | 2026-09-10 最新交付独立复审（当前结论） |
| [5e3d112e6e72](https://github.com/liaboveall/Orbit/tree/archive/snapshot-5e3d112e6e72) | 405 | 2026-09-11 — M0–M4 修复关闭与 M5 准入（当前状态） |
| [775af6e23ddf](https://github.com/liaboveall/Orbit/tree/archive/snapshot-775af6e23ddf) | 443 | 2026-09-11 — M0–M4 最新独立审查（Codex） |
| [77e6a340a094](https://github.com/liaboveall/Orbit/tree/archive/snapshot-77e6a340a094) | 409 | 最近更新：2026-09-10（Codex M0—M4 全面审查） |
| [83e33802aa2d](https://github.com/liaboveall/Orbit/tree/archive/snapshot-83e33802aa2d) | 413 | 最近更新：2026-09-10（M0—M4 全面审查问题修复复验，Kiro） |
| [a498833113f0](https://github.com/liaboveall/Orbit/tree/archive/snapshot-a498833113f0) | 416 | 最近更新：2026-09-10（M0—M4 全面审查问题修复复验，Kiro） |
| [a8e333a57611](https://github.com/liaboveall/Orbit/tree/archive/snapshot-a8e333a57611) | 442 | 2026-09-11 — M4 完成验证 (R1-R12 全部修复) ✅ |
| [b7a52c5decf2](https://github.com/liaboveall/Orbit/tree/archive/snapshot-b7a52c5decf2) | 444 | 2026-09-11 — M0–M4 最新独立审查（Codex） |
| [c6fd923b0217](https://github.com/liaboveall/Orbit/tree/archive/snapshot-c6fd923b0217) | 408 | 最近更新：2026-09-10（独立审查 + 按结论修复并复测，Kiro） |
| [ccc92ac3fc83](https://github.com/liaboveall/Orbit/tree/archive/snapshot-ccc92ac3fc83) | 424 | 最近更新：2026-09-10（M4 收尾修复与验收，Krio/Qoder） |
| [cf7a847f6c34](https://github.com/liaboveall/Orbit/tree/archive/snapshot-cf7a847f6c34) | 413 | 最近更新：2026-09-10（M0—M4 全面审查问题修复复验，Kiro） |
| [d299959271df](https://github.com/liaboveall/Orbit/tree/archive/snapshot-d299959271df) | 428 | 2026-09-10 — M4 完整验证套件通过（David） |
| [d8afa78e7712](https://github.com/liaboveall/Orbit/tree/archive/snapshot-d8afa78e7712) | 417 | 最近更新：2026-09-10（M0—M4 全面审查问题修复复验，Kiro） |
| [fa59b9629374](https://github.com/liaboveall/Orbit/tree/archive/snapshot-fa59b9629374) | 445 | 2026-09-11 — M0–M4 修复关闭与 M5 准入（当前状态） |

## 获取与核验

```sh
git clone https://github.com/liaboveall/Orbit.git
cd Orbit
git fetch origin --tags
git tag --list 'archive/snapshot-*'
git rev-parse 'archive/snapshot-10555e0d7baa^{tree}'
git diff archive/snapshot-10555e0d7baa main -- src tests prisma
```

`rev-parse` 的结果应等于清单内对应的 `originalTree`。如需查看旧版本，可用 `git worktree add ../Orbit-snapshot archive/snapshot-10555e0d7baa`，避免改动当前工作目录。历史快照可能包含已经修复的缺陷，不用于生产部署。

## 发布检查范围

发布前检查了所有 15 份快照的 670 个不同文件对象和当前待提交文件：敏感路径、常见凭证格式、私钥、超过 10 MiB 的文件，以及本机环境文件中的长敏感值匹配。未发现需要移除的真实认证密钥；存储匹配项来自 `.env.example`、本地开发 Compose 和单元测试的示例配置。`.env.local`、构建缓存、运行日志、数据库内容、会话和实际上传附件不进入版本管理。模式扫描不是对任意形式敏感信息的绝对保证。

本次只发布 Git 与文档，没有修改业务代码或执行生产部署。业务验收沿用上述修复报告中实际完成的 787 项测试；发布时另行校验规划文档、Git 对象与远端引用。

## 首次推送实测结果（2026-09-11）

- 当前应用基线提交：`6efa2c5e438fc8853674f304091011df6509c2b7`（479 个文件）。
- GitHub API 确认仓库为 PRIVATE，默认分支为 main；主分支与全部 15 个归档标签推送成功。
- 从 GitHub 全新 bare clone 后，主分支提交与本地一致，15 个标签的 commit 和 tree 均与归档清单逐项一致；`git fsck --full` exit 0。
- `python planning/validate_plan.py`：PASS（118 Markdown、108 本地链接、37 operations、25 tasks）。
- 本次新增和更新的发布文档 `git diff --cached --check` 通过。首次全量基线检查同时报告旧源码、测试和历史文档已有的行尾空白；未为了上传改写这些既有内容，不将全量空白检查记为通过。
- 业务代码未在发布阶段变更，未重跑业务测试或部署；787 项测试证据来自发布前的修复验收。
