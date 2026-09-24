"use client";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { MyTasksQueryDTO, OverviewDTO } from "@/contracts";

/**
 * 工作台统计卡（docs/02 §5 可点击筛选卡）。
 *
 * N02 修复：`rounded-panel` 不是已定义的圆角 token（tokens 只有 control/card/overlay），
 * 统一改用 `rounded-card`（卡片语义，12px）。
 *
 * N03 修复：卡片链接与下方分类 nav 统一口径——保留当前筛选（q/projectId/priority/
 * sort/limit），只替换 bucket，并丢弃旧 cursor（分页随筛选变化失效）。此前卡片仅写
 * bucket，会悄悄丢掉用户已设置的搜索/排序/项目筛选。
 *
 * F32 修复：接受 activeBucket，当前分类的卡片有视觉选中态 + aria-current="true"，
 * 与下方分类 nav 的选中语义一致（读屏可识别）。
 *
 * 统计数字口径：overview 由服务端按用户全量未完成/逾期等口径计算（不受 q/projectId
 * 等筛选影响），卡片上方的筛选状态不改变这些全局计数；选中卡片只表示「当前查看的
 * 分类」，不代表数字已被筛选。
 */
export function WorkbenchStats({
  overview,
  query,
  activeBucket,
}: {
  overview: OverviewDTO;
  /** 当前工作台筛选（用于构造与分类 nav 一致的链接）。 */
  query: MyTasksQueryDTO;
  /** 当前选中的分类（aria-current + 视觉选中态）。 */
  activeBucket: string;
}) {
  const cards = [
    ["逾期任务", overview.overdue, "overdue"],
    ["今天到期", overview.dueToday, "today"],
    ["未来 7 天", overview.upcoming, "upcoming"],
    ["进行中", overview.inProgress, "in_progress"],
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(([title, count, bucket]) => {
        const active = activeBucket === bucket;
        return (
          <Link
            key={bucket}
            href={"/app/today?" + bucketQuery(query, bucket).toString()}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-card border p-5 outline-none focus-visible:ring-2 focus-visible:ring-brand",
              active
                ? "border-brand bg-brand-soft"
                : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <p className={cn("text-caption", active ? "text-brand" : "text-foreground-muted")}>
              {title}
              {active ? <span className="sr-only">（当前分类）</span> : null}
            </p>
            <p
              className={cn(
                "mt-2 text-3xl font-semibold",
                active ? "text-brand" : "text-foreground",
              )}
            >
              {count}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * 构造分类链接查询串：保留 q/projectId/priority/sort/limit，替换 bucket，删除旧 cursor。
 * 与 today/page.tsx 下方分类 nav 的构造逻辑保持一致（N03）。
 */
export function bucketQuery(
  query: MyTasksQueryDTO,
  bucket: string,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "cursor" || key === "bucket" || value === undefined) continue;
    params.set(key, String(value));
  }
  params.set("bucket", bucket);
  return params;
}
