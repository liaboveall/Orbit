import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * 任务详情里重复出现的排版零件。编辑器和「正在打开」的占位面板共用，
 * 所以数据到达、占位换成编辑器时版面不会跳。
 */

/** 详情里的一组内容：浮在面板上的白色圆角分组，像系统设置里的一节。 */
export const detailGroup = "rounded-tile bg-surface shadow-[inset_0_0_0_0.5px_var(--color-line)]";

/** 属性行里的选择器：贴右、无底色。 */
export const propertyControl =
  "h-11 bg-transparent! pl-2 pr-7 text-right shadow-none! [text-align-last:right] md:h-10";

/** 截止日输入框：与属性行里的选择器对齐。 */
export const dueDateControl =
  "mr-1.5 h-11 min-w-0 rounded-[8px] bg-transparent text-right text-body text-foreground outline-none disabled:opacity-55 md:h-10 md:text-label";

/** 详情的任务标题。 */
export const detailTitle = "text-[24px] font-semibold leading-[1.22] tracking-[-0.018em]";

export function PropertyRow({
  label,
  icon: Icon,
  hint,
  children,
}: {
  label: string;
  icon: LucideIcon;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 pl-3.5 pr-2 text-label md:min-h-10">
      <span className="flex min-w-0 items-center gap-2.5 text-foreground-secondary">
        <Icon className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden="true" />
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}
