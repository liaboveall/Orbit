# Qoder 专家团修复交接包

对象：`D:\FullStack\Orbit`，2026-09-09 23 时修复后工作区。目标：修复剩余缺陷并完成 M3，不推进 M4。

## 使用方式

1. 在 Qoder 中打开 Orbit 仓库根目录，使用你已有的专家团工作方式。
2. 将 `04-MASTER-PROMPT.md` 的全文作为任务提示词；它已经要求专家读取其余资料。
3. 保持整个工作区可访问。专家需要查看实际代码、规格和测试，不能只看本资料包。
4. 按 `02-WORK-PACKAGES.md` 分工，同一个文件同一时间只交给一个写入负责人；按实际可用并发数分批即可。本包不依赖任何特定 Qoder 插件或自动分派 API。
5. 用 `03-ACCEPTANCE.md` 验收，最后填写 `05-DELIVERY-TEMPLATE.md`，不得仅以“部分测试通过”结束。

## 文件地图

| 文件 | 用途 |
|---|---|
| 01-REVIEW.md | 本次完整审查报告副本：已修复对照、Q01—Q10、证据、限制 |
| 02-WORK-PACKAGES.md | 专家分工、文件所有权、依赖顺序、共享契约 |
| 03-ACCEPTANCE.md | 可执行的验收场景与通过条件 |
| 04-MASTER-PROMPT.md | 直接粘贴给 Qoder 的主提示词 |
| 05-DELIVERY-TEMPLATE.md | 专家团交付模板，防止完成声明没有证据 |
| 06-FINDINGS.json | 机器可读的问题、优先级、负责人建议、旧问题映射 |

报告主文件位于 `docs/reviews/RE-REVIEW-2026-09-09.md`；包内副本与本次生成时相同。后续修复写新的复验报告，保留本次报告作历史，不反复改写审查原始证据。

## 当前基线

- check/build 已通过；unit 122、contract 136、E2E 8、UI 13 通过。
- integration：163 通过，但一个限流 suite 收集失败，命令 exit 1。
- 上轮 R1/R2/R3/R4/R9 的原缺陷已修复；不要重做。
- 仍须完成真实看板/编辑闭环，以及分页、认证失败、锁超时、限流、UUID 等边界；本轮另确认 no-op 移动、bigint 溢出和详情项目归属问题。
- 真实数据已存在；禁止清库。所有文件尚无 Git 提交基线，禁止重置或覆盖已有工作。

## 证据定位

根目录 `artifacts/re-review-2026-09-09/`：

- `source-manifest.json`：本次源文件/配置 SHA-256。
- `check.log`、`build.log`、`integration.log`、`e2e.log`、`ui.log`。
- `observations.json`：HTTP、认证、分页、真实详情/看板探针。
- `move-boundaries/observations.json`：no-op、溢出、间隙重编号、错误项目路径。
- `infrastructure.json`：迁移、约束、限流时钟与 fallback。
- `probe.ts`、`move-boundaries.ts`、`infrastructure-probe.ts`：隔离合成数据复现脚本。

这些探针是观察记录器，脚本退出 0 **不代表所有观察符合验收**。转成正式回归时，必须对修复后的期望行为写断言。本包不包含环境变量、Cookie、邮件令牌、数据库转储或完整浏览器 trace。
