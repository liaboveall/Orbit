"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { NativeSelect, SearchField, pillClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const SEARCH_DEBOUNCE_MS = 320;
const DEFAULT_SORT = "updated_desc";

/**
 * 工作台的搜索与排序：保留当前分类，改动立即生效。
 * 右端的「已完成」在待办和已完成之间切换；它不是待办分类，所以不占一格磁贴。
 */
export function WorkbenchFilters() {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQuery = search.get("q") ?? "";
  const urlSort = search.get("sort") ?? DEFAULT_SORT;
  const [sort, setOptimisticSort] = useOptimistic(urlSort);
  const [typed, setTyped] = useState(urlQuery);
  const [committed, setCommitted] = useState(urlQuery);
  if (urlQuery !== committed) {
    setCommitted(urlQuery);
    setTyped(urlQuery);
  }

  function apply(q: string, nextSort: string) {
    setCommitted(q);
    startTransition(() => {
      setOptimisticSort(nextSort);
      const params = new URLSearchParams(search.toString());
      params.delete("cursor");
      if (q) params.set("q", q);
      else params.delete("q");
      if (nextSort !== DEFAULT_SORT) params.set("sort", nextSort);
      else params.delete("sort");
      router.replace(path + (params.size ? `?${params}` : ""), { scroll: false });
    });
  }

  useEffect(() => {
    const q = typed.trim();
    if (q === committed) return;
    const timer = setTimeout(() => apply(q, sort), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = search.get("bucket") === "done";
  const doneParams = new URLSearchParams(search.toString());
  doneParams.delete("cursor");
  if (done) doneParams.delete("bucket");
  else doneParams.set("bucket", "done");

  return (
    <form
      role="search"
      aria-label="筛选我的任务"
      className="mb-3 flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        apply(typed.trim(), sort);
      }}
    >
      <SearchField
        name="q"
        aria-label="搜索任务"
        placeholder="搜索我的任务"
        maxLength={100}
        pending={pending}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        className="min-w-0 flex-1 sm:max-w-72"
      />
      <NativeSelect
        aria-label="排序"
        data-active={sort !== DEFAULT_SORT ? "" : undefined}
        value={sort}
        onChange={(event) => apply(typed.trim(), event.target.value)}
      >
        <option value="updated_desc">最近更新</option>
        <option value="due_asc">截止日期</option>
        <option value="priority_desc">优先级</option>
      </NativeSelect>
      <Link
        href={path + (doneParams.size ? `?${doneParams}` : "")}
        scroll={false}
        aria-current={done ? "true" : undefined}
        data-active={done ? "" : undefined}
        className={cn(pillClass, "ml-auto inline-flex shrink-0 items-center gap-1.5 px-3.5 outline-none")}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
        已完成
      </Link>
    </form>
  );
}
