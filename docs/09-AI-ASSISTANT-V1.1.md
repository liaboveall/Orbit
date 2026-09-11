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
