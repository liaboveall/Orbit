import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Input / Textarea（ORB-002 基础组件）。
 *
 * 高度 40px（h-10，触控端可加 className="h-11"），圆角 rounded-control(8)，
 * 边界用 border-control（line-strong，实测 3.63:1 满足控件边界 3:1）。
 * `aria-invalid` 时切换为 danger 边界；焦点环走全局 :focus-visible。
 */

const fieldBase =
  "w-full rounded-control border bg-surface text-foreground placeholder:text-foreground-muted " +
  "transition-[border-color,box-shadow] duration-150 ease-standard " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-invalid:border-danger aria-invalid:bg-danger-soft/40";

export type InputProps = ComponentProps<"input">;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        fieldBase,
        "h-10 border-line-strong px-3 text-label outline-none",
        className,
      )}
      {...props}
    />
  );
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        fieldBase,
        "resize-y border-line-strong px-3 py-2 text-body outline-none",
        className,
      )}
      {...props}
    />
  );
}

export type LabelProps = ComponentProps<"label">;

/** 表单标签：14px，与控件保持 8px 间距由调用方布局控制。 */
export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "block text-label font-medium text-foreground-secondary",
        className,
      )}
      {...props}
    />
  );
}
