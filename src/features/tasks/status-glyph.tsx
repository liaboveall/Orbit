import { Check } from "lucide-react";
import type { TaskStatus } from "@/contracts";
import { cn } from "@/lib/cn";

/** 任务状态图形：空心圆、半圆、对勾。形状本身可区分，不只靠颜色。 */
export function StatusGlyph({ status, className }: { status: TaskStatus; className?: string }) {
  if (status === "DONE") {
    return (
      <span
        aria-hidden="true"
        className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success text-[var(--color-surface-solid)]", className)}
      >
        <Check className="h-3 w-3" strokeWidth={3.2} />
      </span>
    );
  }
  if (status === "IN_PROGRESS") {
    return (
      <span
        aria-hidden="true"
        className={cn("block h-[18px] w-[18px] rounded-full border-[1.75px] border-brand-ink p-[2.25px]", className)}
      >
        <span className="block h-full w-full rounded-full bg-[conic-gradient(var(--color-brand-ink)_0_50%,transparent_50%)]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn("block h-[18px] w-[18px] rounded-full border-[1.75px] border-line-strong", className)}
    />
  );
}
