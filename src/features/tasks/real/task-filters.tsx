"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui";
import { TASK_STATUS, TASK_PRIORITY, type MemberDTO } from "@/contracts";
import { STATUS_LABEL, PRIORITY_LABEL } from "../task-meta";

const inputClass =
  "min-w-0 rounded-control border border-line bg-surface px-3 py-2 text-caption outline-none focus-visible:ring-2 focus-visible:ring-brand";
export function TaskFilters({
  projectId,
  members,
  board = false,
}: {
  projectId: string;
  members: MemberDTO[];
  board?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const viewQuery = new URLSearchParams(search.toString());
  viewQuery.delete("task");
  viewQuery.delete("cursor");
  viewQuery.delete("sort");
  return (
    <div className="mb-5 space-y-3">
      <nav className="flex gap-4 text-label" aria-label="任务视图">
        <Link
          aria-current={!board ? "page" : undefined}
          href={`/app/projects/${projectId}/tasks?${viewQuery}`}
        >
          列表
        </Link>
        <Link
          aria-current={board ? "page" : undefined}
          href={`/app/projects/${projectId}/board?${viewQuery}`}
        >
          看板
        </Link>
      </nav>
      <form
        key={search.toString()}
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const query = new URLSearchParams();
          for (const [key, value] of form) {
            if (typeof value === "string" && value) query.set(key, value);
          }
          if (query.get("assigneeId") === "__unassigned") {
            query.delete("assigneeId");
            query.set("unassigned", "true");
          }
          router.replace(path + (query.size ? "?" + query : ""));
        }}
      >
        <input
          className={inputClass + " grow"}
          type="search"
          name="q"
          aria-label="搜索任务"
          placeholder="搜索标题或编号"
          maxLength={100}
          defaultValue={search.get("q") ?? ""}
        />
        <select
          className={inputClass}
          name="status"
          aria-label="筛选状态"
          defaultValue={search.get("status") ?? ""}
        >
          <option value="">全部状态</option>
          {TASK_STATUS.map((x) => (
            <option key={x} value={x}>
              {STATUS_LABEL[x]}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          name="priority"
          aria-label="筛选优先级"
          defaultValue={search.get("priority") ?? ""}
        >
          <option value="">全部优先级</option>
          {TASK_PRIORITY.map((x) => (
            <option key={x} value={x}>
              {PRIORITY_LABEL[x]}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          name="assigneeId"
          aria-label="筛选负责人"
          defaultValue={
            search.get("unassigned") === "true"
              ? "__unassigned"
              : (search.get("assigneeId") ?? "")
          }
        >
          <option value="">全部负责人</option>
          <option value="__unassigned">未分配</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        {!board && (
          <select
            className={inputClass}
            name="sort"
            aria-label="排序"
            defaultValue={search.get("sort") ?? "updated_desc"}
          >
            <option value="updated_desc">最近更新</option>
            <option value="due_asc">截止日期</option>
            <option value="priority_desc">优先级</option>
          </select>
        )}
        <label className="flex items-center gap-1 text-caption">
          <input
            name="overdue"
            value="true"
            type="checkbox"
            defaultChecked={search.get("overdue") === "true"}
          />
          仅逾期
        </label>
        <Button size="sm" type="submit">
          应用筛选
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => router.replace(path)}
        >
          清除
        </Button>
      </form>
    </div>
  );
}
