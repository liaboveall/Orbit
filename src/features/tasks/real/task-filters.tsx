"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";
import { NativeSelect, SearchField, pillClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { TASK_STATUS, TASK_PRIORITY, type MemberDTO } from "@/contracts";
import { STATUS_LABEL, PRIORITY_LABEL } from "../task-meta";

const SEARCH_DEBOUNCE_MS = 320;

type FilterValues = {
  status: string;
  priority: string;
  assignee: string;
  sort: string;
  overdue: boolean;
};

const DEFAULT_SORT = "updated_desc";
const EMPTY: FilterValues = { status: "", priority: "", assignee: "", sort: DEFAULT_SORT, overdue: false };

/** 只把用户真正设置的条件写进 URL，地址保持干净，也便于分享。 */
function toParams(q: string, values: FilterValues): URLSearchParams {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (values.status) params.set("status", values.status);
  if (values.priority) params.set("priority", values.priority);
  if (values.assignee === "__unassigned") params.set("unassigned", "true");
  else if (values.assignee) params.set("assigneeId", values.assignee);
  if (values.sort && values.sort !== DEFAULT_SORT) params.set("sort", values.sort);
  if (values.overdue) params.set("overdue", "true");
  return params;
}

/**
 * 任务工具条：搜索、筛选，右端是页面的主操作。
 * 筛选改动立即生效，搜索在停止输入后生效，回车立即生效。
 * URL 是唯一真源；筛选在途时用 useOptimistic 让控件先显示新值。
 */
export function TaskFilters({
  members,
  board = false,
  action,
}: {
  members: MemberDTO[];
  /** 看板固定按手动顺序排列，不提供排序。 */
  board?: boolean;
  /** 工具条右端的主操作，例如「新建任务」。 */
  action?: ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const urlQuery = search.get("q") ?? "";
  const urlValues: FilterValues = {
    status: search.get("status") ?? "",
    priority: search.get("priority") ?? "",
    assignee: search.get("unassigned") === "true" ? "__unassigned" : (search.get("assigneeId") ?? ""),
    sort: search.get("sort") ?? DEFAULT_SORT,
    overdue: search.get("overdue") === "true",
  };
  const [values, setOptimisticValues] = useOptimistic(urlValues);

  // 输入框有自己的状态：刷新回来的旧 URL 不能覆盖用户还在输入的文字。
  // 只有 URL 被外部改变（后退、清除）时才同步。
  const [typed, setTyped] = useState(urlQuery);
  const [committed, setCommitted] = useState(urlQuery);
  if (urlQuery !== committed) {
    setCommitted(urlQuery);
    setTyped(urlQuery);
  }

  const navigate = useCallback(
    (q: string, next: FilterValues) => {
      setCommitted(q);
      startTransition(() => {
        setOptimisticValues(next);
        const params = toParams(q, next);
        router.replace(path + (params.size ? `?${params}` : ""), { scroll: false });
      });
    },
    [path, router, setOptimisticValues],
  );

  const change = (patch: Partial<FilterValues>) => navigate(typed.trim(), { ...values, ...patch });

  useEffect(() => {
    const q = typed.trim();
    if (q === committed) return;
    const timer = setTimeout(() => navigate(q, values), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // values 变化已由 change() 带着最新文字提交，这里只响应输入。
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = Boolean(
    urlQuery ||
      values.status ||
      values.priority ||
      values.assignee ||
      values.overdue ||
      (!board && values.sort !== DEFAULT_SORT),
  );

  return (
    <form
      role="search"
      aria-label="筛选任务"
      className="mb-4 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(typed.trim(), values);
      }}
    >
      <SearchField
        name="q"
        aria-label="搜索任务"
        placeholder="搜索标题或编号"
        maxLength={100}
        pending={pending}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        className="order-1 min-w-0 flex-1 sm:w-56 sm:flex-none lg:w-64"
      />

      {/* 手机上筛选项横向滑动，不换成多行堆叠；滑动区左右延伸到屏幕边缘。 */}
      <div className="no-scrollbar order-3 -mx-4 flex min-w-0 basis-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 py-0.5 sm:order-2 sm:mx-0 sm:flex-1 sm:basis-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:py-0 [&>*]:shrink-0">
        <NativeSelect
          aria-label="筛选状态"
          data-active={values.status ? "" : undefined}
          value={values.status}
          onChange={(event) => change({ status: event.target.value })}
        >
          <option value="">全部状态</option>
          {TASK_STATUS.map((x) => (
            <option key={x} value={x}>{STATUS_LABEL[x]}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="筛选优先级"
          data-active={values.priority ? "" : undefined}
          value={values.priority}
          onChange={(event) => change({ priority: event.target.value })}
        >
          <option value="">全部优先级</option>
          {TASK_PRIORITY.map((x) => (
            <option key={x} value={x}>{PRIORITY_LABEL[x]}优先级</option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="筛选负责人"
          wrapperClassName="max-w-44"
          data-active={values.assignee ? "" : undefined}
          value={values.assignee}
          onChange={(event) => change({ assignee: event.target.value })}
        >
          <option value="">全部负责人</option>
          <option value="__unassigned">未分配</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}</option>
          ))}
        </NativeSelect>
        {!board && (
          <NativeSelect
            aria-label="排序"
            data-active={values.sort !== DEFAULT_SORT ? "" : undefined}
            value={values.sort}
            onChange={(event) => change({ sort: event.target.value })}
          >
            <option value="updated_desc">最近更新</option>
            <option value="due_asc">截止日期</option>
            <option value="priority_desc">优先级</option>
          </NativeSelect>
        )}
        <label
          data-active={values.overdue ? "" : undefined}
          className={cn(
            pillClass,
            // relative：隐藏的复选框以这颗胶囊定位，留在横向滑动区里，不把页面撑宽。
            "relative inline-flex cursor-pointer items-center px-3.5",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
          )}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={values.overdue}
            onChange={(event) => change({ overdue: event.target.checked })}
          />
          仅逾期
        </label>
        {active ? (
          <button
            type="button"
            onClick={() => {
              setTyped("");
              navigate("", EMPTY);
            }}
            className="inline-flex h-11 items-center gap-1 rounded-full px-3 text-body text-foreground-secondary outline-none transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground md:h-9 md:text-label"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            清除
          </button>
        ) : null}
      </div>

      {action ? <div className="order-2 shrink-0 sm:order-3">{action}</div> : null}
    </form>
  );
}
