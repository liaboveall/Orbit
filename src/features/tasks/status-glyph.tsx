import type { TaskStatus } from "@/contracts";
import { CheckMark } from "@/components/ui/check-mark";
import { cn } from "@/lib/cn";

/**
 * 任务状态图形：空心圆、半满的圆、对勾。形状本身可区分，不只靠颜色。
 * `animate` 用在状态刚变化的那一下：完成时圆点弹一下并画出对勾，其它状态轻轻弹入。
 */
export function StatusGlyph({
  status,
  animate = false,
  className,
}: {
  status: TaskStatus;
  animate?: boolean;
  className?: string;
}) {
  const base = cn("h-[18px] w-[18px] shrink-0 rounded-full", animate && "animate-check-pop");
  if (status === "DONE") {
    return (
      <span aria-hidden="true" className={cn(base, "flex items-center justify-center bg-success text-[var(--color-surface-solid)]", className)}>
        <CheckMark animate={animate} strokeWidth={3.4} className="h-[65%] w-[65%]" />
      </span>
    );
  }
  if (status === "IN_PROGRESS") {
    return (
      <span aria-hidden="true" className={cn(base, "block border-[1.75px] border-brand-ink p-[2.25px]", className)}>
        <span className="block h-full w-full rounded-full bg-[conic-gradient(var(--color-brand-ink)_0_50%,transparent_50%)]" />
      </span>
    );
  }
  return <span aria-hidden="true" className={cn(base, "block border-[1.75px] border-line-strong", className)} />;
}
