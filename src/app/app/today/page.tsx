import Link from "next/link";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getOverview, listMyTasks } from "@/server/modules/workbench/service";
import { MyTasksQuerySchema, MyTaskBuckets } from "@/contracts";
import { WorkbenchStats } from "@/features/workbench/workbench-stats";

/** 与 workbench-stats.tsx 的 bucketQuery 相同口径（服务端组件内联副本，N03）。 */
function bucketQuery(
  query: Record<string, unknown>,
  bucket: string,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "cursor" || key === "bucket" || value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  params.set("bucket", bucket);
  return params;
}
import { MyTasksList } from "@/features/workbench/task-list";
export const dynamic = "force-dynamic";
export const metadata = { title: "我的工作台 · Orbit" };
const labels = [
  "全部未完成",
  "逾期",
  "今天到期",
  "未来 7 天",
  "进行中",
  "已完成",
];
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const raw = await searchParams;
  const parsed = MyTasksQuerySchema.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)),
  );
  if (!parsed.success)
    return (
      <div className="p-6">
        <p role="alert">筛选参数不合法。</p>
        <Link href="/app/today">清除筛选</Link>
      </div>
    );
  const query = parsed.data,
    now = new Date();
  let overview;
  let result;
  try {
    [overview, result] = await Promise.all([
      getOverview(user.id, now),
      listMyTasks(user.id, query, now),
    ]);
  } catch (error) {
    if (error instanceof DomainError && error.code === "VALIDATION_ERROR") {
      return (
        <div className="p-6">
          <p role="alert">筛选参数不合法。</p>
          <Link href="/app/today">清除筛选</Link>
        </div>
      );
    }
    throw error;
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold">我的工作台</h1>
        <p className="mt-1 text-caption text-foreground-muted">
          {overview.today} · {overview.timezone} · 全部未完成{" "}
          {overview.totalOpen}
        </p>
      </header>
      <WorkbenchStats
        overview={overview}
        query={query}
        activeBucket={query.bucket ?? "all_open"}
      />
      <nav aria-label="任务分类" className="flex flex-wrap gap-2">
        {MyTaskBuckets.map((bucket, i) => (
          <Link
            key={bucket}
            aria-current={
              (query.bucket ?? "all_open") === bucket ? "page" : undefined
            }
            className="rounded-control border border-line px-3 py-2 text-label aria-[current=page]:bg-brand aria-[current=page]:text-white focus-visible:outline-2 focus-visible:outline-brand"
            href={
              "/app/today?" +
              bucketQuery(query, bucket).toString()
            }
          >
            {labels[i]}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-3" action="/app/today">
        <input type="hidden" name="bucket" value={query.bucket ?? "all_open"} />
        {query.projectId && (
          <input type="hidden" name="projectId" value={query.projectId} />
        )}
        {query.priority && (
          <input type="hidden" name="priority" value={query.priority} />
        )}
        <label className="flex flex-col gap-1 text-caption">
          搜索任务
          <input
            name="q"
            defaultValue={query.q}
            maxLength={100}
            className="rounded-control border border-line bg-surface px-3 py-2 text-body md:text-label"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption">
          排序
          <select
            name="sort"
            defaultValue={query.sort ?? "updated_desc"}
            className="rounded-control border border-line bg-surface px-3 py-2 text-body md:text-label"
          >
            <option value="updated_desc">最近更新</option>
            <option value="due_asc">截止日期</option>
            <option value="priority_desc">优先级</option>
          </select>
        </label>
        <button className="rounded-control bg-brand px-4 py-2 text-white">
          筛选
        </button>
      </form>
      <MyTasksList
        key={user.id}
        initialTasks={result.tasks}
        nextCursor={result.nextCursor}
        query={query}
      />
    </main>
  );
}
