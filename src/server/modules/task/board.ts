import "server-only";
import {
  BoardSchema,
  UuidSchema,
  type BoardDTO,
  type BoardQueryDTO,
  type TaskStatus,
} from "@/contracts";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  projectNotFoundError,
  projectVisibleSql,
  requireProjectMember,
} from "@/server/modules/authorization/project-access";
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
import { buildTaskSummary, type TaskExtras, type TaskSummaryRow } from "./mappers";

function boardConflictError(currentBoardVersion: number): DomainError {
  return new DomainError("BOARD_CONFLICT", "看板已更新，请重新加载。", undefined, { currentBoardVersion });
}

/** 已返回前缀（按 position,id 顺序）的集合摘要；只用于判定分页之间筛选集合是否变化。 */
function prefixDigest(ids: string[]): string {
  return sha256Hex(ids.join(","));
}

const ALL_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

/** 续页游标里携带的列内位置与一致性信息（全部视为不可信输入，逐项校验）。 */
interface BoardCursor {
  position: string;
  id: string;
  boardVersion: number;
  returned: number;
  digest: string;
}

function parseBoardCursor(raw: string, fingerprint: string): BoardCursor {
  const cursor = decodeCursor(raw, fingerprint);
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
  if (pos < -9223372036854775808n || pos > 9223372036854775807n) throw invalidCursorError();
  return { position, id: cursor.id.toLowerCase(), boardVersion: version, returned, digest };
}

/** 看板语句的一行：项目级列每行重复，任务列在该页没有任务时为 null。 */
type BoardRow = {
  boardVersion: number;
  /** 只在第一行有值。 */
  totals: Partial<Record<TaskStatus, number>> | null;
  /** 只在续页请求的第一行有值。 */
  prefixIds: string[] | null;
  position: string | null;
  assigneeName: string | null;
  creatorName: string | null;
  subtaskTotal: number | null;
  subtaskCompleted: number | null;
  commentCount: number | null;
  attachmentCount: number | null;
} & { [K in keyof TaskSummaryRow]: TaskSummaryRow[K] | null };

/**
 * 看板读取：授权、boardVersion、各列总数、当页任务及其姓名和计数，全部来自**同一条语句**。
 *
 * 一条语句就是一个快照，不需要再包 REPEATABLE READ 事务：列数据、总数与 boardVersion 不会
 * 来自不同时刻，成员关系也在同一快照里复核（刚被移除的成员拿不到数据）。此前这里是一个
 * 事务里的二十多条顺序语句。
 *
 * 分页游标绑定三件事（docs/04 §5、docs/05 §6）：过滤指纹、boardVersion（顺序/成员集合），
 * 以及本列已返回前缀的数量与摘要。优先级、标题、负责人、截止日等变化不递增 boardVersion，
 * 却可能让任务进入或离开筛选集合；续页时前缀与游标不一致即返回 BOARD_CONFLICT，
 * 客户端整体重新读取，而不是拼出「已加载完」却缺卡片的结果。
 *
 * @param viewerTimezone 调用方已持有的会话用户时区；提供后「仅逾期」筛选不再单独查一次 User。
 */
export async function getBoard(
  projectId: string,
  userId: string,
  query: BoardQueryDTO = {},
  viewerTimezone?: string,
): Promise<BoardDTO> {
  if (query.assigneeId && query.unassigned)
    throw new DomainError(
      "VALIDATION_ERROR",
      "负责人和未分配筛选不能同时使用。",
    );
  if (query.cursor && !query.status) throw invalidCursorError();

  // 项目 key（编号搜索与 identifier 需要）和 404 判定；数据语句里会在同一快照再次复核成员关系。
  const { project } = await requireProjectMember(prisma, projectId, userId);

  let today: string | null = null;
  if (query.overdue) {
    const timezone =
      viewerTimezone ??
      (await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone;
    today = dateInTimezone(registrationTimezone(timezone));
  }

  const statuses = query.status ? [query.status] : ALL_STATUSES;
  const limit = Math.min(query.limit ?? 50, 100);
  const fingerprintOf = (status: TaskStatus) =>
    computeFilterFingerprint({
      projectId: project.id,
      status,
      q: query.q ?? "",
      priority: query.priority ?? null,
      assigneeId: query.assigneeId ?? null,
      unassigned: query.unassigned ?? false,
      overdue: query.overdue ?? false,
      today,
    });
  const cursor = query.cursor && query.status ? parseBoardCursor(query.cursor, fingerprintOf(query.status)) : null;

  const filters: Prisma.Sql[] = [];
  if (query.q) {
    // 转义 ILIKE 通配符（PG 默认反斜杠转义），q 中的 % 与 _ 只按字面匹配。
    const pattern = `%${query.q.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
    const numberText = query.q.toUpperCase().replace(project.key + "-", "");
    const number = /^\d+$/.test(numberText) ? Number(numberText) : 0;
    filters.push(
      Number.isSafeInteger(number) && number > 0 && number <= 2147483647
        ? Prisma.sql`AND (t.title ILIKE ${pattern} OR t.number = ${number}::int)`
        : Prisma.sql`AND t.title ILIKE ${pattern}`,
    );
  }
  if (query.priority) filters.push(Prisma.sql`AND t.priority = ${query.priority}::"TaskPriority"`);
  if (query.assigneeId) filters.push(Prisma.sql`AND t."assigneeId" = ${query.assigneeId}`);
  if (query.unassigned) filters.push(Prisma.sql`AND t."assigneeId" IS NULL`);
  // 用户日历日期决定逾期，不以 UTC 今天代替。
  if (today) filters.push(Prisma.sql`AND t."dueDate" < ${today}::date AND t.status <> 'DONE'`);

  // 续页：游标及其之前的行是「已返回前缀」，之后的行是本页候选。
  const afterCursor = cursor
    ? Prisma.sql`(f.position, f.id) > (${cursor.position}::bigint, ${cursor.id}::uuid)`
    : Prisma.sql`TRUE`;
  const prefixIds = cursor
    ? Prisma.sql`(SELECT coalesce(json_agg(f.id ORDER BY f.position, f.id), '[]'::json)
                  FROM filtered f WHERE NOT (${afterCursor}))`
    : Prisma.sql`NULL::json`;

  // 各列总数和续页前缀是整个结果共用的，只放在第一行（row_number() = 1）：前缀可以有上千个
  // id，每行都带一份会让一次「加载更多」传回几兆字节。
  const rows = await prisma.$queryRaw<BoardRow[]>`
    WITH project AS (
      SELECT p.id, p."boardVersion"
      FROM "Project" p
      WHERE p.id = ${project.id}::uuid AND ${projectVisibleSql(userId)}
    ), filtered AS (
      SELECT t.id, t."projectId", t.number, t.title, t.status, t.priority, t."dueDate", t."completedAt",
        t.version, t."deletedAt", t."createdAt", t."updatedAt", t."assigneeId", t."creatorId", t.position
      FROM "Task" t
      WHERE t."projectId" = (SELECT id FROM project)
        AND t."deletedAt" IS NULL
        AND t.status = ANY(${statuses}::"TaskStatus"[])
        ${filters.length > 0 ? Prisma.join(filters, " ") : Prisma.empty}
    ), page AS (
      SELECT f.*, row_number() OVER (PARTITION BY f.status ORDER BY f.position ASC, f.id ASC) AS page_rank
      FROM filtered f
      WHERE ${afterCursor}
    )
    SELECT
      project."boardVersion" AS "boardVersion",
      CASE WHEN row_number() OVER (ORDER BY page.status, page.position, page.id) = 1 THEN
        (SELECT coalesce(json_object_agg(c.status, c.total), '{}'::json)
           FROM (SELECT f.status, count(*) AS total FROM filtered f GROUP BY f.status) c)
      END AS totals,
      CASE WHEN row_number() OVER (ORDER BY page.status, page.position, page.id) = 1 THEN
        ${prefixIds}
      END AS "prefixIds",
      page.id, page."projectId", page.number, page.title, page.status, page.priority, page."dueDate",
      page."completedAt", page.version, page."deletedAt", page."createdAt", page."updatedAt",
      page."assigneeId", page."creatorId", page.position::text AS position,
      assignee.name AS "assigneeName", creator.name AS "creatorName",
      (SELECT count(*) FROM "Subtask" s WHERE s."taskId" = page.id AND s."deletedAt" IS NULL)::int AS "subtaskTotal",
      (SELECT count(*) FROM "Subtask" s WHERE s."taskId" = page.id AND s."deletedAt" IS NULL AND s."isCompleted")::int AS "subtaskCompleted",
      (SELECT count(*) FROM "Comment" c WHERE c."taskId" = page.id AND c."deletedAt" IS NULL)::int AS "commentCount",
      (SELECT count(*) FROM "Attachment" a WHERE a."taskId" = page.id AND a."deletedAt" IS NULL
         AND a.state IN ('UPLOADING', 'READY'))::int AS "attachmentCount"
    FROM project
    LEFT JOIN page ON page.page_rank <= ${limit + 1}::int
    LEFT JOIN "User" assignee ON assignee.id = page."assigneeId"
    LEFT JOIN "User" creator ON creator.id = page."creatorId"
    ORDER BY page.status, page.position, page.id
  `;

  // 没有行：项目在数据语句的快照里已不可见（刚被移除成员或项目不存在）。
  const head = rows[0];
  if (!head) throw projectNotFoundError();
  const boardVersion = head.boardVersion;

  let prefix: string[] = [];
  if (cursor) {
    if (cursor.boardVersion !== boardVersion) throw boardConflictError(boardVersion);
    // 同一快照内复核已返回前缀：筛选集合在分页之间变化（任务进入/离开）即冲突。
    prefix = head.prefixIds ?? [];
    if (prefix.length !== cursor.returned || prefixDigest(prefix) !== cursor.digest)
      throw boardConflictError(boardVersion);
  }

  const extras: TaskExtras = { people: new Map(), counts: new Map(), projectKeys: new Map() };
  const byStatus = new Map<TaskStatus, Array<TaskSummaryRow & { position: string }>>();
  for (const row of rows) {
    if (row.id === null) continue; // 该页没有任务时的占位行
    const task = row as unknown as TaskSummaryRow & { position: string };
    if (row.assigneeId && row.assigneeName !== null) extras.people.set(row.assigneeId, row.assigneeName);
    if (row.creatorName !== null) extras.people.set(task.creatorId, row.creatorName);
    extras.counts.set(task.id, {
      subtaskTotal: row.subtaskTotal ?? 0,
      subtaskCompleted: row.subtaskCompleted ?? 0,
      commentCount: row.commentCount ?? 0,
      attachmentCount: row.attachmentCount ?? 0,
    });
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
    else byStatus.set(task.status, [task]);
  }

  const columns = statuses.map((status) => {
    const found = byStatus.get(status) ?? [];
    const page = found.slice(0, limit);
    const last = page.at(-1);
    return {
      status,
      total: Number(head.totals?.[status] ?? 0),
      items: page.map((task) => buildTaskSummary(task, { projectKey: project.key }, extras)),
      nextCursor:
        found.length > limit && last
          ? encodeCursor(
              [
                last.position,
                boardVersion,
                prefix.length + page.length,
                prefixDigest([...prefix, ...page.map((task) => task.id)]),
              ],
              last.id,
              fingerprintOf(status),
            )
          : null,
    };
  });
  // 整块响应在这里校验一次（每个任务 DTO 也只经过这一次）。
  return BoardSchema.parse({ boardVersion, columns });
}
