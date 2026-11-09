import Link from "next/link";
import { buttonVariants, InlineError, PageHeader } from "@/components/ui";
import { MyTasksQuerySchema } from "@/contracts";
import { MyTasksList } from "@/features/workbench/task-list";
import { WorkbenchFilters } from "@/features/workbench/workbench-filters";
import { WorkbenchStats } from "@/features/workbench/workbench-stats";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getOverview, listMyTasks } from "@/server/modules/workbench/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "我的工作台 · Orbit" };

function InvalidFilters() {
  return (
    <div className="space-y-3 pt-6">
      <InlineError>筛选参数不合法。</InlineError>
      <Link href="/app/today" className={buttonVariants({ variant: "secondary" })}>
        清除筛选
      </Link>
    </div>
  );
}

/** overview.today 已是用户时区的日期，这里只做中文展示，不再换算。 */
function formatToday(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${date}T00:00:00Z`));
}

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
  if (!parsed.success) return <InvalidFilters />;
  const query = parsed.data;
  const now = new Date();
  let overview;
  let result;
  try {
    [overview, result] = await Promise.all([
      getOverview(user.id, now),
      listMyTasks(user.id, query, now),
    ]);
  } catch (error) {
    if (error instanceof DomainError && error.code === "VALIDATION_ERROR") return <InvalidFilters />;
    throw error;
  }
  return (
    <div className="pt-2 md:pt-5">
      <PageHeader
        eyebrow={formatToday(overview.today)}
        title="我的工作台"
        description="今天，先把重要的事做好。"
      />
      <WorkbenchStats overview={overview} query={query} activeBucket={query.bucket ?? "all_open"} />
      <WorkbenchFilters />
      <MyTasksList
        key={user.id}
        initialTasks={result.tasks}
        nextCursor={result.nextCursor}
        query={query}
        today={overview.today}
      />
    </div>
  );
}
