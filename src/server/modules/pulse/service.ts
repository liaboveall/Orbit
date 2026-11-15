import "server-only";
import { PulseSchema, type PulseDTO } from "@/contracts";
import { prisma } from "@/server/db/prisma";
import { sha256Hex } from "@/server/modules/stable-json";

/**
 * 变更探测（GET /my/pulse，docs/03 §6、docs/05 §6）。
 *
 * 客户端用它回答「我能看到的内容有没有变」，变了才重新读取页面数据，取代每个页面、
 * 每个子列表各自的定时刷新。整个探测是**一条语句**，只读 Project 行和几个按项目的小聚合。
 *
 * 每个项目的标记由这些值派生，任何成员可见的变化都会改变其中至少一个：
 *  - revision：每条活动日志在同一语句里加一（activity/writer.ts）。任务、子任务、评论、
 *    附件完成/删除、成员加入/退出/移除、项目资料与归档都会写活动，所以都会推进它。
 *    它在项目锁内递增，按提交顺序严格单调；活动的时间戳不具备这一点。
 *  - version / boardVersion / archivedAt / updatedAt：项目资料、看板顺序与归档状态。
 *  - reservedBytes / usedBytes：附件预留、失败与清理不写活动，但一定改变这两个计数。
 *  - 邀请的总数、已撤销数、已接受数：邀请创建与撤销不写活动（docs/05 §9）。
 *  - 成员（含 owner）资料的最近更新时间：改名会改变任务卡上的姓名。
 *
 * 标记是这些值的 SHA-256 截断，不透明、不可逆，不泄露计数或时间。
 */

const TOKEN_LENGTH = 16;

type PulseRow = {
  id: string;
  name: string;
  color: string;
  archivedAt: Date | null;
  updatedAt: Date;
  version: number;
  boardVersion: number;
  revision: number;
  reservedBytes: string;
  usedBytes: string;
  invitations: string;
  peopleUpdatedAt: Date | null;
};

function token(parts: ReadonlyArray<string | number | null>): string {
  return sha256Hex(JSON.stringify(parts)).slice(0, TOKEN_LENGTH);
}

const time = (value: Date | null): number | null => (value ? value.getTime() : null);

/**
 * 当前用户拥有或参与的全部项目（含已归档）的变更标记。
 * 只按会话用户过滤，不接受任何客户端指定的用户或项目，因此不会泄露不可访问的项目。
 */
export async function getPulse(userId: string): Promise<PulseDTO> {
  const rows = await prisma.$queryRaw<PulseRow[]>`
    SELECT p.id, p.name, p.color::text AS color, p."archivedAt", p."updatedAt", p.version,
      p."boardVersion", p.revision,
      p."reservedBytes"::text AS "reservedBytes", p."usedBytes"::text AS "usedBytes",
      (SELECT count(*) || ':' || count(i."revokedAt") || ':' || count(i."acceptedAt")
         FROM "Invitation" i WHERE i."projectId" = p.id) AS invitations,
      (SELECT max(u."updatedAt") FROM "User" u
         WHERE u.id IN (
           SELECT p."ownerId"
           UNION ALL
           SELECT m."userId" FROM "ProjectMember" m WHERE m."projectId" = p.id
         )) AS "peopleUpdatedAt"
    FROM "Project" p
    WHERE p.id IN (
      SELECT o.id FROM "Project" o WHERE o."ownerId" = ${userId}
      UNION ALL
      SELECT m."projectId" FROM "ProjectMember" m WHERE m."userId" = ${userId}
    )
    ORDER BY p.id
  `;

  const projects = rows.map((row) => ({
    id: row.id,
    token: token([
      row.id,
      row.revision,
      row.version,
      row.boardVersion,
      time(row.archivedAt),
      time(row.updatedAt),
      row.reservedBytes,
      row.usedBytes,
      row.invitations,
      time(row.peopleUpdatedAt),
    ]),
  }));
  // 侧栏只展示名称、颜色与最近更新顺序；集合本身的增减（加入、退出、被移除）也在其中。
  const shell = token(
    rows.flatMap((row) => [row.id, row.name, row.color, time(row.archivedAt), time(row.updatedAt), row.version]),
  );
  const overall = token([shell, ...projects.map((project) => project.token)]);

  return PulseSchema.parse({ token: overall, shell, projects });
}
