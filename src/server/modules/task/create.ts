import "server-only";
import { UuidSchema } from "@/contracts";
import type { CreateTaskDTO, TaskDTO, TaskPriority, TaskStatus } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { MAX_OPEN_TASKS } from "@/server/modules/limits";
import { appendActivity } from "@/server/modules/activity/writer";
import {
  beginIdempotency,
  commitIdempotency,
  hashRequest,
  IdempotencyCommitConflictError,
} from "@/server/modules/idempotency/service";
import {
  projectNotFoundError,
  requireProjectMember,
} from "@/server/modules/authorization/project-access";
import {
  assertAssigneeAllowed,
  countOpenTasks,
  requireWritableTaskProject,
  taskLimitExceededError,
} from "./access";
import { nextTaskNumber, formatIdentifier } from "./identifier";
import { appendToColumnEnd } from "./position";
import { fromDueDateString } from "./date-only";
import { toTaskDTO } from "./mappers";
import { readTaskReplay } from "./replay";

/**
 * 创建任务服务（M2 / ORB-008，docs/01 §6、docs/04 §3/§4/§5、docs/05 §5）。
 *
 * 事务原子序列（锁顺序 Project 优先）：
 *   lockProjectRow → requireWritableTaskProject（成员 + 非归档）→ beginIdempotency →
 *   配额计数 → 取号 nextTaskNumber → 追加列尾 position → INSERT Task →
 *   boardVersion++ → 写活动 TASK_CREATED → commitIdempotency。
 *
 * 不变量：
 *  - 每项目未删除任务数 < MAX_OPEN_TASKS(1000)，超限 → 422 LIMIT_EXCEEDED；
 *  - creatorId 由会话确定，绝不接受请求体传入（docs/01 §6）；
 *  - assigneeId 若有值必须是项目 owner/成员，否则 → 422 ASSIGNEE_NOT_MEMBER；
 *  - status=DONE 时 completedAt=now（DB CHECK 强制 DONE⇔completedAt）；
 *  - 默认 status=TODO、priority=MEDIUM（docs/01 §6）；
 *  - 幂等：同 key 同 body 重放原响应（重放前已过成员/归档复核）。
 */

/** 创建任务的默认状态与优先级（docs/01 §6：默认 TODO、MEDIUM、无负责人、无截止日）。 */
export const DEFAULT_TASK_STATUS: TaskStatus = "TODO";
export const DEFAULT_TASK_PRIORITY: TaskPriority = "MEDIUM";

/** createTask 的幂等 routeKey（docs/04 §3：含真实资源 ID 的规范化路径）。 */
export function createTaskRouteKey(projectId: string): string {
  return `POST /projects/${projectId}/tasks`;
}

/** createTask 的结果：DTO + 是否为幂等重放。 */
export interface CreateTaskResult {
  task: TaskDTO;
  replayed: boolean;
}

/** 构造 400 VALIDATION_ERROR（字段级提示）。 */
function validationError(fieldErrors: Record<string, string[]>): DomainError {
  return new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", fieldErrors);
}

/**
 * 创建任务。
 *
 * @param projectId 路径参数（UUID），已由契约层校验形状。
 * @param userId 会话确认的当前用户 id（作为 creator，绝不接受请求体传入）。
 * @param input 已过 CreateTaskSchema 形状校验的请求体。
 * @param idempotencyKey 已过 requireIdempotencyKey 校验的合法 UUID。
 */
export async function createTask(
  projectId: string,
  userId: string,
  input: CreateTaskDTO,
  idempotencyKey: string,
): Promise<CreateTaskResult> {
  // 入口形状守卫：非法 UUID → 404，避免 lockProjectRow 的 `${projectId}::uuid` 触发 PG 22P02 → 500。
  if (!UuidSchema.safeParse(projectId).success) throw projectNotFoundError();

  // 锁前无锁成员预检（用应用单例 prisma，非 tx）：非成员/不存在快速拒绝，避免非成员对热门项目行
  // 加排他锁造成 DoS 面；归档态与写权限仍在锁内由 requireWritableTaskProject 权威复核。
  await requireProjectMember(prisma, projectId, userId);

  const requestHash = hashRequest(input);
  projectId = projectId.toLowerCase();
  const routeKey = createTaskRouteKey(projectId);

  const execute = () => withTransaction(async (tx) => {
    // 锁顺序最前：Project（串行化编号、配额、position 与 boardVersion）。
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    // 持锁后复核授权与归档态（成员可见 + 非归档；非成员/不存在 → 404，归档 → 409）。
    const { project } = await requireWritableTaskProject(tx, projectId, userId);

    const begin = await beginIdempotency(tx, {
      userId,
      method: "POST",
      routeKey,
      key: idempotencyKey,
      requestHash,
    });
    if (begin.kind === "replay") {
      // 重放前已重新确认成员关系与项目可写（requireWritableTaskProject），可安全回放原结果。
      return { task: await readTaskReplay(tx, projectId, begin), replayed: true };
    }

    // 标题 trim 后须 1–120（DB CHECK btrim(title)<>'' 兜底）。
    const title = input.title.trim();
    if (title.length < 1 || title.length > 120) {
      throw validationError({ title: ["任务标题需为 1—120 个字符"] });
    }
    const description = input.description?.trim() ?? "";
    if (description.length > 10000) {
      throw validationError({ description: ["任务描述不能超过 10000 个字符"] });
    }

    // 配额：锁内计数未删除任务（docs/04 §6）。
    if ((await countOpenTasks(tx, projectId)) >= MAX_OPEN_TASKS) throw taskLimitExceededError();

    // 负责人归属校验（null 表示无负责人）。
    const assigneeId = input.assigneeId ?? null;
    await assertAssigneeAllowed(tx, project, assigneeId);

    const status = input.status ?? DEFAULT_TASK_STATUS;
    const priority = input.priority ?? DEFAULT_TASK_PRIORITY;
    const dueDate = input.dueDate ? fromDueDateString(input.dueDate) : null;
    const completedAt = status === "DONE" ? new Date() : null;

    const number = await nextTaskNumber(tx, projectId);
    const position = await appendToColumnEnd(tx, projectId, status);

    const data: Prisma.TaskUncheckedCreateInput = {
      projectId,
      number,
      creatorId: userId,
      assigneeId,
      title,
      description,
      status,
      priority,
      dueDate,
      position,
      completedAt,
      version: 1,
    };
    const created = await tx.task.create({ data });

    // 看板顺序集合变化 → boardVersion++（不 bump Project.updatedAt，docs/04 §4）。
    await tx.$executeRaw`
      UPDATE "Project" SET "boardVersion" = "boardVersion" + 1 WHERE id = ${projectId}::uuid
    `;

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "TASK",
      entityId: created.id,
      action: "TASK_CREATED",
      metadata: { taskIdentifier: formatIdentifier(project.key, number) },
    });

    const row = await tx.task.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        assignee: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    });
    const task = toTaskDTO(row, { projectKey: project.key });

    await commitIdempotency(tx, {
      userId,
      method: "POST",
      routeKey,
      key: idempotencyKey,
      requestHash,
      responseStatus: 201,
      responseBody: task,
      resourceId: created.id,
    });

    return { task, replayed: false };
  });

  try {
    return await execute();
  } catch (error) {
    // commitIdempotency 撞唯一键（P2002）→ 事务已 aborted，须在事务外复查 hash（见 idempotency/service.ts）。
    if (error instanceof IdempotencyCommitConflictError) {
      // 在新事务和项目锁内重新执行授权、目标可见性及幂等检查。
      return await execute();
    }
    throw error;
  }
}
