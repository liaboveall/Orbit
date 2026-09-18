# Orbit 全面完善交付独立验收 · 2026-09-18

## 结论

**本轮交付需返工，不接受“仓库内修复已完成”的结论；保留已经正确完成的改动。** 交付有真实进展，基础门禁也有可信通过证据，但存在新引入的敏感配置副本残留、治理绕过、Linux CI 网络不兼容和多项错误关闭记录。

对照材料：[任务书](REVIEW-ANALYSIS-2026-09-18.md)、[执行指令](../../prompts/AGENT-IMPROVEMENT-2026-09-18.md)、[交付报告](IMPROVEMENT-EXECUTION-2026-09-18.md)、[交付方台账](../../planning/improvement-audit-2026-09-18.json)。本报告为独立验收意见，原交付报告与台账保留，不能将其中 26 fixed 自动理解为本次验收认可。

范围限制：当前 HEAD 仍为 abe4149，所有轮次成果混在未提交工作区，不能把相对 HEAD 的整个 diff 都归因于本轮 Agent。本轮核对当前文件、前次读取记录和交付证据；没有连接业务数据库，没有重跑完整 integration/E2E/UI，没有重新构建或联网扫描镜像，没有刷新远端 CI/PR。没有修业务代码、提交、推送、删除历史数据或历史临时副本。

本次实际启动了一个现有交付 runner 镜像，注入公开示例配置和合成值，将数据库指向不可用的本机端口，仅验证不需数据库的路由；容器已在 finally 中删除。其他反例在内存或已忽略的独立验收目录运行，未改正式契约和 backlog 做探针。

## 独立验证与可接受的进展

| 验证 | 本轮结果 | 解释 |
| --- | --- | --- |
| pnpm lint | exit 0 | 当前源码通过；历史 gate-summary 中 lint=1 不代表当前仍失败。 |
| pnpm typecheck:scripts | exit 0 | 当前脚本类型检查通过。 |
| pnpm exec tsc --noEmit | exit 0 | 使用当前已生成客户端；不是重新执行 prisma generate 的完整 pnpm typecheck。 |
| pnpm test:unit | exit 0，270 passed | 独立执行。 |
| pnpm test:contract | exit 0，173 passed | 独立执行；通过不等于测试能检测所有声明的漂移。 |
| runner --self-test | exit 0 | 合成 teardown exit 1 判失败，正常 exit 0 判成功，缺失程序记录 exit 127。 |
| run_validation 当前输入 | PASS | 不运行写 VALIDATION.md 的 main。 |
| 治理反例 | 错误接受 V1 complete | 见 IA-03。 |
| query-binding 变异副本 | 11 passed，exit 0 | 故意破坏五种契约关系仍绿，见 IA-04。 |
| 池失败路径提取探针 | holderReleased=true，poolEnded=false | 受控替身验证 finally 控制流，不冒充真实数据库耗尽复验。 |
| 交付 runner HTTP 探针 | /api/v1 为 HTML 404 | 子路径 JSON 兜底有效；根路径遗漏，见 IA-06。 |

核读交付方 `integration-serial.log` 确有 360 passed 和两库内容指纹一致；`gate-e2e.log`/`gate-ui.log` 确有 85/13 passed 及指纹一致。与 2026-09-17 的失败日志不同，这些日志支持受控运行取得了进展；本轮没有独立重跑，不能宣称重新验证了所有数据库/浏览器行为。

限流用例已改为固定用户/操作键的 60/61 边界及时间恢复；错误码测试已读取真实 docs/05；任务 taskIds、双向关联和部分状态校验已实现；镜像扫描没有通过全局 ignore-unfixed 等方式被隐藏。这些工作应保留。

## 必须返工的发现

### IA-01 · P1：治理探针批量复制本地配置且不清理

- 位置：`planning/validate_plan_probes.py:20-29`、该文件 main 中的 PROBES 循环。
- `fresh_copy()` 对整个仓库 copytree；排除项没有 `.env*`、凭证、私有附件等敏感目录，并且每次 mkdtemp 后没有 TemporaryDirectory/finally 清理。
- 本轮只检查目录与文件存在性，实际发现系统临时目录下 **66 个 orbit-probe-* 目录，66 个包含 repo/.env.local**。未读取或输出其值；没有证据表明这些副本曾外传。副本内容与原文件是否完全相同也没有读取比较。
- 每次标准探针会再制造 11 份类似副本，所以本次没有直接重跑该原始探针脚本。CI 把此入口常态化后问题会持续发生。
- 修复：只复制校验所需的明确文件集合，排除所有本地配置/用户数据；用受控临时目录并在成功/失败路径清理。用合成敏感文件哨兵证明“不复制且不残留”。已有 66 份副本先核对来源和绝对路径，形成精准清理清单后按会话授权处理，不广泛删除临时目录。
- 关联：OI-04、OI-07、OI-17。新增问题，不能计作已完成。

### IA-02 · P1：新接入 CI 的容器烟测依赖 Docker Desktop 的主机名

- 位置：`scripts/container-smoke.mjs:7,18`，`.github/workflows/ci.yml:64-67`。
- 脚本固定将数据库主机改成 `host.docker.internal`，docker run 没有 host-gateway 映射、共享 Compose 网络或 Linux 适配。CI 运行在 ubuntu-24.04 Docker Engine；本地 Windows Docker Desktop 的成功不能证明该网络路径在 CI 有效。
- 同时 `infra/compose.dev.yml` 的数据库发布端口仅绑定宿主 127.0.0.1；仅机械补 --add-host 也不能当作完整解决方案。
- Docker 官方区分了 [Desktop 的特殊主机名](https://docs.docker.com/desktop/features/networking/networking-how-tos/) 和 [Engine 的 host-gateway 映射](https://docs.docker.com/reference/cli/docker/container/run/)。这是源码和环境配置推导出的 CI 缺陷，本轮没有实际运行远端 Ubuntu 工作流。
- 修复：按平台实现可达的测试拓扑，例如让应用加入合成服务的 Compose 网络并使用服务名/容器端口，或经过验证的 Linux 专用 host 网络方案；保留本地回环绑定和清理约束。增加真实 Linux 启动、ready、匿名 API 和停止清理验证。
- 关联：OI-19，退回 pending。

### IA-03 · P1：V1 完成门禁仍受待校验数据自行定义

- 位置：`planning/validate_plan.py:157-165`。
- V1 的成员集合通过 `milestone.release == "V1"` 从 backlog 动态选出，未强制核对项目固定的 M0—M6 发布边界。
- **内存复现**：只将 M6.release 从 V1 改为 V1.1，再将 applicationStatus 置 V1_RELEASE_ACCEPTANCE_COMPLETE。M6 仍 review，相关开放项与任务状态都保留，校验结果却为 PASS。
- 现有 v1-complete-without-evidence 探针只改 applicationStatus，因此没有覆盖此绕过。
- 修复：校验 M0—M6 必须属于 V1、M7 属于 V1.1，检查里程碑唯一性/完整性；V1 完成必须同时具备规定的外部验收证据，而不只是非空 evidence 数组。为上述两字段变异加入负面用例。
- 关联：OI-05，退回 pending。

### IA-04 · P2：契约绑定测试的声明远超实际断言能力

- 位置：`tests/contract/query-binding.test.ts:72-88,186-229`。
- 参数覆盖集合直接从同一份 OpenAPI 参数列表生成，“已声明路由内新增参数必须验证”的检查会自动接受新参数。没有明确逐参数绑定表。
- operation 检查只保留 responses 的状态码键；从不核对成功响应 data 对应的具体 schema。错误响应只在 `$ref` 存在时检查名称，缺整个 content/schema 时反而跳过。
- **受控复现**：复制这 11 个测试到独立目录，仅让它们读到内存变异后的契约：项目列表 data.items 的引用从 Project 改 Task；任务搜索 q 改成 required；q.maxLength 改 1；新增未实现的必填 query 参数；删除项目列表 401 的 JSON 错误信封。**11 个测试仍全部通过。** 正式契约文件没改。
- 这不是说全部 173 个测试都没有价值，而是该新增测试不能证明交付报告声称的完整参数/响应绑定及变异检出能力。
- 修复：建立 operation→实际请求 schema→各响应 schema 的明确映射，逐参数双向比对，缺失 content/ref 必须失败；让同一个正式比较器接受正样本并拒绝真实变异，不只对变异对象写几个“确实改过”的断言。
- 关联：OI-15，退回 pending。

### IA-05 · P2：修复吞断言后，断言失败路径仍泄漏连接池

- 位置：`tests/integration/db-connection-errors.test.ts:71-80`。
- rejects 断言失败会执行第一个 finally 的 holder.release，然后直接向外抛出，后面的第二个 try/finally 根本不会进入，因此 pool.end 不执行。
- 提取当前代码控制流、注入会抛断言错误的受控替身，结果为 assertionFailurePropagated=true、holderReleased=true、poolEnded=false。正常路径通过的 5 个测试不能证明失败清理可靠。
- 修复：用包住整个验证流程的外层 finally 确保 pool.end，内层管理 holder 的释放；同时覆盖 pool.connect 失败及断言失败路径。
- 关联：OI-08，退回 pending；保留已修复的“异常不再被吞”部分。

### IA-06 · P2：API 根路径仍漏出 HTML

- 位置：`src/app/api/v1/[...path]/route.ts`、`src/proxy.ts` 对 `/api/v1/` 的前缀判断。
- `[...path]` 必须有后续路径段，不匹配 `/api/v1`；没有根 route。当前安装的 Next 文档也区分了普通与 optional catch-all。
- **现有交付镜像实测**：GET /api/v1（无 Cookie/合成 Cookie）均为 404、text/html；GET /api/v1/unknown-probe 无 Cookie 为 JSON 401、有合成 Cookie 为 JSON 404；GET /api/v1/projects 匿名为 JSON 401。
- 探针不构造真实会话，不连接数据库，不能用这些结果宣称真实鉴权整体通过。它们已足以证明根路径遗漏。
- 修复：根据 API 规范处理根路径及规范化后的尾斜杠，补真实路由匹配测试；不要只直接调用 handler。保留现有路由优先级、匿名和 HEAD 无 body 语义。
- 关联：OI-13，退回 pending。

### IA-07 · P2：旧维护入口未修，却把 OI-22 关闭

- 位置：`scripts/cleanup-invitation-tokens.ts:20-29`、`scripts/cleanup-invitation-constraints.ts:24,76`。
- 写入口仍只检查 --apply 与数据库名称字符串，没有接入维护目标指纹或 APP_ENV 校验。同名库换了服务器仍能满足同一确认字符串。
- 只读检查脚本仍引用不存在的 SAFE.md、输出 tokenHash 前缀及行标识。没有证据证明这些内容导致了泄漏，但任务明确要求的入口治理尚未完成。
- 台账 changedFiles 为空，closureEvidence 主要是对另一套 maintenance 入口的守卫验证和旧脚本 candidates:0；它不能证明旧写入口已受到相同保护。
- 修复：逐个入口确认副作用，将仍需保留的写入口纳入目标确认方案，或安全停用并指向替代命令；只读入口作最小字段投影/脱敏，修失效说明。用合成环境验证，不能试运行旧脚本的真实 --apply 来证明风险。
- 关联：OI-22，退回 pending。

### IA-08 · P2：若干“fixed”仅重述既有状态，没有满足指定验收

以下应拆分已完成子项和仍未完成子项，不能继续汇总为“26 fixed、仓库内全部完成”：

| 条目 | 当前反证/缺口 | 需要的关闭依据 |
| --- | --- | --- |
| OI-06 | PROGRESS 仍保留“当前最新状态”两处及第二个“Orbit 当前开发状态”；没有完成历史标题归位 | 唯一当前入口，历史内容清晰标注，链接有效。 |
| OI-18 | infra/compose.production.yml 未改，仍无 logging；AWS 内联模板与仓库文件仍是两份人工维护配置，CI 未展示对两种生产方案的配置验证 | 明确支持边界、受测权威配置/覆盖文件，两种部署的日志轮转和运行验证。外部 DB 不使 web 的日志磁盘风险消失。 |
| OI-19/20 | verify-backup.sh 仍未加入 CI；现有受测内容不能替代执行指令要求的受控故障/恢复入口 | 备份验证入口可重复执行并有门禁或明确运维入口；本地与生产恢复分开。 |
| OI-25/29 | “不误关弹层”的合成测试有效，但未验证真实候选词取消；200% 缩放明确没验收却整体 fixed | 将未验收部分显式保留，而非用 85+13 总数覆盖。 |
| OI-11 | 当前用户名称/表计数能帮助分类，不能单独证明每个关联缺失的历史原因 | 保留原始记录/备份缺口；不将“可以经授权删除合成残留”写成历史恢复的替代路径。 |

同样，迁移仍未跟踪；OI-03 的“完整入库交付”只能理解为工作区文件已准备，不能理解为已提交。OI-02 已公开标明未提交，因此不把未获授权推送本身判作违规。

### IA-09 · P2：完整门禁证据没有使用已强化的统一记录机制

- `artifacts/improvement-20260918/` 中仅发现 gate-summary.txt，里面记录首轮 lint=1 及部分命令；没有本次完整门禁的 summary.json/source-hashes.json。后续 gate-lint.log 无错误，本轮独立 lint 也通过，不能据旧一行断言当前 lint 失败。
- runner 自测证明的是 runner 本身对退出码的处理，不证明此次 gate-*.log 实际由它采集或绑定到同一源码。更不能把自测 manifest 当真实全量验收 manifest。
- runner 源清单还漏了 docs；新增 error-codes 测试直接读取 docs/05，规划校验也读取文档，因此这些是验证输入。当前只有运行前散列，没有运行后身份核对。
- 修复：最终候选状态稳定后，用统一入口捕获所有实际执行命令、完整退出码、时间、源码身份和日志散列，涵盖会影响验证的文档/配置；保留失败尝试与后续成功尝试，不互相覆盖。无需为了凑数量重复无关测试。
- 关联：OI-07，退回 pending。

### IA-10 · P2：仅用总 CVE 数否定替代基座，评估依据不足

- 交付称 trixie 25 个唯一 CVE 比当前 18 更多，所以更差、只能等上游。本轮解析的是交付留存 JSON，未联网重扫。
- `runner.json`：56 包级记录，18 唯一 CVE，0 有 FixedVersion。
- `trixie.json`：60 包级记录，25 唯一 CVE；其中 **17 个唯一 CVE 有 FixedVersion，8 个没有**。
- 这不证明升级/改用 trixie 一定可发布，也不证明所有 17 个修复都能立即在当前构建中安装；但已足以否定仅凭 25>18 得出的“替代更差、无本地工作可做”。报告比较的是未按同一策略修补的基座与已修补的当前应用镜像，条件不对等。
- 修复：在隔离候选构建中评估可用补丁/最小依赖与兼容性，再按相同扫描条件比较剩余风险；仍需修复、有效例外或保留发布阻塞。不能将“继承上游”当作不影响本应用的证据。禁止为了变绿放宽门禁。
- 关联：OI-12 保持发布阻塞，但补充本地评估工作，不能只写等待上游。

## 证据位置与复现边界

本轮本地受控探针位于 `artifacts/independent-review-20260918/`，被 Git 忽略，不含真实凭证：

- `governance-probe.py`：只 monkeypatch 内存读入的 backlog，真实文件不变。
- `mutation.config.mjs` / `query-binding-mutated.test.ts`：复制新增契约测试并给它们读入坏契约；正式文件不变。
- `pool-failure-probe.cjs`：提取实际测试片段，替身只用于验证异常控制流。
- `http-probe.mjs`：复用现有交付镜像，合成配置、无可达数据库、容器总是清理。
- `runner-selftest/`：本轮 runner 自测生成的摘要与日志，仅属于自测，不是应用全量门禁。

干净克隆不会自动获得 artifacts；需要复验时按本报告中的输入变异及受控方法重建，正式修复应把相应有效回归放入受版本控制的测试，不把临时探针复制品当永久测试体系。

## 建议返工顺序及完成条件

1. 优先停止治理脚本继续复制本地配置，修 IA-01；随后精确处理遗留副本，保留不含秘密的数量/来源记录。
2. 修 IA-02/03：让新 CI 在 Linux 真能启动，并堵住发布归属绕过。
3. 修 IA-04—07：补真正的契约比较、失败清理、API 根路径和旧维护入口。
4. 按 IA-08 重开或拆分误关条目；按 IA-10 完成可比的候选镜像评估。
5. 最后按 IA-09 生成真实候选版本的完整证据；只对受影响范围和最终发布门禁执行必要验证。

M6 保持 review，V1 不得宣称发布完成；M7 不启动。保留工作区既有正确实现，不重写整个项目，不清空数据库。上述结论是对指定交付的验收，不是对所有业务代码无缺陷的保证。
