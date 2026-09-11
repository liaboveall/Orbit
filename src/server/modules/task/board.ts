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
import { fromDueDateString } from "./date-only";
import { toTaskSummaryDTO, fetchTaskResourceCountsBatch } from "./mappers";

/** One repeatable-read transaction for authorization, version, totals and all columns. */
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
      const columns = await Promise.all(
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
          if (query.cursor) {
            const cursor = decodeCursor(query.cursor, fingerprint);
            const [position, version] = cursor.sortValues;
            if (
              cursor.sortValues.length !== 2 ||
              typeof position !== "string" ||
              !/^-?\d{1,19}$/.test(position) ||
              !UuidSchema.safeParse(cursor.id).success ||
              typeof version !== "number" ||
              !Number.isSafeInteger(version) ||
              version < 1
            )
              throw invalidCursorError();
            const pos = BigInt(position);
            if (pos < -9223372036854775808n || pos > 9223372036854775807n)
              throw invalidCursorError();
            if (version !== project.boardVersion)
              throw new DomainError(
                "BOARD_CONFLICT",
                "看板已更新，请重新加载。",
                undefined,
                { currentBoardVersion: project.boardVersion },
              );
            filters.push({
              OR: [
                { position: { gt: pos } },
                { position: pos, id: { gt: cursor.id } },
              ],
            });
          }
          const rows = await tx.task.findMany({
            where: { AND: filters },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            take: limit + 1,
            include: {
              assignee: { select: { id: true, name: true } },
              creator: { select: { id: true, name: true } },
            },
          });
          const page = rows.slice(0, limit);
          const batchCounts=await fetchTaskResourceCountsBatch(tx,page.map(task=>task.id));
          const last = page.at(-1);
          return {
            status,
            total,
            items: await Promise.all(
              page.map(async (task) => {
                const counts = batchCounts.get(task.id)!;
                return toTaskSummaryDTO(task, { projectKey: project.key }, counts);
              })
            ),
            nextCursor:
              rows.length > limit && last
                ? encodeCursor(
                    [last.position.toString(), project.boardVersion],
                    last.id,
                    fingerprint,
                  )
                : null,
          };
        }),
      );
      return BoardSchema.parse({ boardVersion: project.boardVersion, columns });
    },
    { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 2000 },
  );
}
