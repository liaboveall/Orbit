"use client";

import { Loader2, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { NativeSelect } from "@/components/ui/input";

const SEARCH_DEBOUNCE_MS = 320;

/** 工作台搜索与排序：保留当前分类、项目和优先级，改动立即生效。 */
export function WorkbenchFilters() {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQuery = search.get("q") ?? "";
  const urlSort = search.get("sort") ?? "updated_desc";
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
      if (nextSort !== "updated_desc") params.set("sort", nextSort);
      else params.delete("sort");
      router.replace(path + (params.size ? `?${params}` : ""), { scroll: false });
    });
  }

  useEffect(() => {
    const q = typed.trim();
    if (q === committed) return;
    const timer = setTimeout(() => apply(q, sort), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // 排序变化由 onChange 带着最新文字提交，这里只响应输入。
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form
      role="search"
      aria-label="筛选我的任务"
      className="mb-4 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        apply(typed.trim(), sort);
      }}
    >
      <label className="glass-chip relative flex h-11 min-w-48 flex-1 items-center rounded-full pl-9 pr-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring sm:max-w-72 md:h-9">
        <span className="sr-only">搜索任务</span>
        {pending ? (
          <Loader2 className="absolute left-3 h-4 w-4 animate-spin text-foreground-muted" aria-hidden="true" />
        ) : (
          <Search className="absolute left-3 h-4 w-4 text-foreground-muted" aria-hidden="true" />
        )}
        <input
          name="q"
          type="search"
          aria-label="搜索任务"
          placeholder="搜索我的任务"
          maxLength={100}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="field w-full min-w-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted md:text-label [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>
      <NativeSelect aria-label="排序" value={sort} onChange={(event) => apply(typed.trim(), event.target.value)}>
        <option value="updated_desc">最近更新</option>
        <option value="due_asc">截止日期</option>
        <option value="priority_desc">优先级</option>
      </NativeSelect>
    </form>
  );
}
