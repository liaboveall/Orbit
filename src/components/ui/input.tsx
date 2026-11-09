import type { ComponentProps } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Input / Textarea / NativeSelect / Label。
 *
 * 空输入框靠边框识别，line-strong 对比度不低于 3:1。手机端字号固定 16px，
 * 避免 iOS Safari 聚焦时自动放大页面。
 */

const fieldBase =
  "field w-full rounded-control border border-line-strong bg-[var(--input-fill)] text-foreground outline-none " +
  "placeholder:text-foreground-muted transition-[border-color,box-shadow,background-color] duration-200 ease-standard " +
  "focus:border-ring focus:shadow-[0_0_0_1px_var(--color-ring),0_0_0_5px_var(--color-brand-soft)] " +
  "disabled:cursor-not-allowed disabled:opacity-55 " +
  "aria-invalid:border-danger aria-invalid:bg-danger-soft";

const mobileFontBase = "text-body md:text-label";

export type InputProps = ComponentProps<"input">;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(fieldBase, mobileFontBase, "h-11 px-3.5 md:h-10", className)}
      {...props}
    />
  );
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(fieldBase, mobileFontBase, "resize-y px-3.5 py-2.5", className)}
      {...props}
    />
  );
}

export type LabelProps = ComponentProps<"label">;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn("block text-label font-medium text-foreground-secondary", className)}
      {...props}
    />
  );
}

export type NativeSelectProps = ComponentProps<"select"> & {
  /** 外层定位容器的样式，控制宽度与外边距。 */
  wrapperClassName?: string;
};

/**
 * 原生下拉：弹出的菜单由系统绘制，在 Apple 设备上就是标准的系统菜单。
 * 控件上的文字本身可识别，所以这里用细边界。
 */
export function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <span className={cn("relative inline-flex min-w-0 items-center", wrapperClassName)}>
      <select
        className={cn(
          "glass-chip h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full border-0 pl-3.5 pr-8 text-body text-foreground outline-none md:h-9 md:text-label",
          "transition-[background-color,color] duration-200 ease-standard",
          "disabled:cursor-not-allowed disabled:opacity-55",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronsUpDown
        className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-foreground-muted"
        aria-hidden="true"
      />
    </span>
  );
}
