import "server-only";
import {
  BoardSchema,
  UuidSchema,
  type BoardDTO,
  type BoardQueryDTO,
  type TaskStatus,
} from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireProjectMember } from "@/server/modules/authorization/project-access";
import { DomainError } from "@/server/http/errors";
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  invalidCursorError,
} from "@/server/modules/pagination/cursor";
import { dateInTimezone } from "@/lib/calendar";
import { registrationTimezone } from "@/server/auth/user-fields";
import { sha256Hex } from "@/server/modules/stable-json";
import { fromDueDateString } from "./date-only";
import { TASK_SUMMARY_SELECT_FOR_BOARD, toTaskSummaryDTO, fetchTaskResourceCountsBatch } from "./mappers";

function boardConflictError(currentBoardVersion: number): DomainError {
  return new DomainError("BOARD_CONFLICT", "看板已更新，请重新加载。", undefined, { currentBoardVersion });
}

/** 已返回前缀（按 position,id 顺序）的集合摘要；只用于判定分页之间筛选集合是否变化。 */
function prefixDigest(ids: string[]): string {
  return sha256Hex(ids.join(","));
}

/**
 * One repeatable-read transaction for authorization, version, totals and all columns.
 *
 * 分页游标绑定三件事（docs/04 §4、docs/05 §6）：过滤指纹、boardVersion（顺序/成员集合），
 * 以及本列已返回前缀的数量与摘要。优先级、标题、负责人、截止日等变化不递增 boardVersion，
 * 却可能让任务进入或离开筛选集合；续页时前缀与游标不一致即返回 BOARD_CONFLICT，
 * 客户端整体重新读取，而不是拼出「已加载完」却缺卡片的结果。
 */
export async function getBoard(
  projectId: string,
  userId: string,
  query: BoardQueryDTO = {},
): Promise<BoardDTO> {
  if (query.assigneeId && query.unassigned)
    throw new DomainError(
      "VALIDATION_ERROR",
      "负责人和未分配筛选不能同时使用。",
    );
  if (query.cursor && !query.status) throw invalidCursorError();
  return prisma.$transaction(
    async (tx) => {
      const { project } = await requireProjectMember(tx, projectId, userId);
      const user = query.overdue
        ? await tx.user.findUnique({
            where: { id: userId },
            select: { timezone: true },
          })
        : null;
      const today = query.overdue
        ? dateInTimezone(registrationTimezone(user?.timezone))
        : null;
      const statuses: TaskStatus[] = query.status
        ? [query.status]
        : ["TODO", "IN_PROGRESS", "DONE"];
      const limit = Math.min(query.limit ?? 50, 100);
      const pages = await Promise.all(
        statuses.map(async (status) => {
          const fingerprint = computeFilterFingerprint({
            projectId: project.id,
            status,
            q: query.q ?? "",
            priority: query.priority ?? null,
            assigneeId: query.assigneeId ?? null,
            unassigned: query.unassigned ?? false,
            overdue: query.overdue ?? false,
            today,
          });
          const filters: Prisma.TaskWhereInput[] = [
            { projectId: project.id, status, deletedAt: null },
          ];
          if (query.q) {
            const escaped = query.q.replace(/[\\%_]/g, (ch) => "\\" + ch);
            const numberText = query.q
              .toUpperCase()
              .replace(project.key + "-", "");
            const number = /^\d+$/.test(numberText) ? Number(numberText) : 0;
            const match: Prisma.TaskWhereInput[] = [
              { title: { contains: escaped, mode: "insensitive" } },
            ];
            if (
              Number.isSafeInteger(number) &&
              number > 0 &&
              number <= 2147483647
            )
              match.push({ number });
            filters.push({ OR: match });
          }
          if (query.priority) filters.push({ priority: query.priority });
          if (query.assigneeId) filters.push({ assigneeId: query.assigneeId });
          if (query.unassigned) filters.push({ assigneeId: null });
          if (today)
            filters.push({
              dueDate: { lt: fromDueDateString(today) },
              status: { not: "DONE" },
            });
          const total = await tx.task.count({ where: { AND: filters } });
          let prefix: string[] = [];
          if (query.cursor) {
            const cursor = decodeCursor(query.cursor, fingerprint);
            const [position, version, returned, digest] = cursor.sortValues;
            if (
              cursor.sortValues.length !== 4 ||
              typeof position !== "string" ||
              !/^-?\d{1,19}$/.test(position) ||
              !UuidSchema.safeParse(cursor.id).success ||
              typeof version !== "number" ||
              !Number.isSafeInteger(version) ||
              version < 1 ||
              typeof returned !== "number" ||
              !Number.isSafeInteger(returned) ||
              returned < 1 ||
              typeof digest !== "string" ||
              !/^[0-9a-f]{64}$/.test(digest)
            )
              throw invalidCursorError();
            const pos = BigInt(position);
            if (pos < -9223372036854775808n || pos > 9223372036854775807n)
              throw invalidCursorError();
            if (version !== project.boardVersion)
              throw boardConflictError(project.boardVersion);
            // 同一快照内复核已返回前缀：筛选集合在分页之间变化（任务进入/离开）即冲突。
            prefix = (
              await tx.task.findMany({
                where: {
                  AND: [
                    ...filters,
                    {
                      OR: [
                        { position: { lt: pos } },
                        { position: pos, id: { lte: cursor.id } },
                      ],
                    },
                  ],
                },
                orderBy: [{ position: "asc" }, { id: "asc" }],
                select: { id: true },
              })
            ).map((row) => row.id);
            if (prefix.length !== returned || prefixDigest(prefix) !== digest)
              throw boardConflictError(project.boardVersion);
            filters.push({
              OR: [
                { position: { gt: pos } },
                { position: pos, id: { gt: cursor.id } },
              ],
            });
          }
          // F14：看板列使用显式投影（含 position 游标字段），不拉取 description。
          const rows = await tx.task.findMany({
            where: { AND: filters },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            take: limit + 1,
            select: TASK_SUMMARY_SELECT_FOR_BOARD,
          });
          const page = rows.slice(0, limit);
          const last = page.at(-1);
          return {
            status,
            total,
            page,
            nextCursor:
              rows.length > limit && last
                ? encodeCursor(
                    [
                      last.position.toString(),
                      project.boardVersion,
                      prefix.length + page.length,
                      prefixDigest([...prefix, ...page.map((task) => task.id)]),
                    ],
                    last.id,
                    fingerprint,
                  )
                : null,
          };
        }),
      );
      // All three columns share a snapshot and one batch of resource aggregates.
      const counts = await fetchTaskResourceCountsBatch(tx, pages.flatMap(column => column.page.map(task => task.id)));
      const columns = await Promise.all(pages.map(async ({ page, ...column }) => ({
        ...column,
        items: await Promise.all(page.map(task => toTaskSummaryDTO(task, { projectKey: project.key }, counts.get(task.id)!))),
      })));
      return BoardSchema.parse({ boardVersion: project.boardVersion, columns });
    },
    { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 2000 },
  );
}
