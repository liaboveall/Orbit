import type { ComponentProps } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

/**
 * Input / Textarea / Label / NativeSelect / SearchField。
 *
 * 空输入框靠边框识别，line-strong 对比度不低于 3:1。手机端字号固定 16px，
 * 避免 iOS Safari 聚焦时自动放大页面。
 */

const fieldBase =
  "field w-full rounded-control border border-line-strong bg-[var(--input-fill)] text-foreground outline-none " +
  "placeholder:text-foreground-muted transition-[border-color,box-shadow,background-color] duration-200 ease-standard " +
  "focus:border-ring focus:bg-surface-solid focus:shadow-[0_0_0_1px_var(--color-ring),0_0_0_5px_var(--color-brand-soft)] " +
  "disabled:cursor-not-allowed disabled:opacity-55 " +
  "aria-invalid:border-danger aria-invalid:bg-danger-soft";

const mobileFontBase = "text-body md:text-label";

export type InputProps = ComponentProps<"input">;

export function Input({ className, type = "text", ...props }: InputProps) {
  return <input type={type} className={cn(fieldBase, mobileFontBase, "h-11 px-3.5 md:h-10", className)} {...props} />;
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea rows={rows} className={cn(fieldBase, mobileFontBase, "resize-y px-3.5 py-2.5 leading-relaxed", className)} {...props} />
  );
}

export type LabelProps = ComponentProps<"label">;

export function Label({ className, ...props }: LabelProps) {
  return <label className={cn("block text-label font-medium text-foreground-secondary", className)} {...props} />;
}

/** 胶囊控件共用的外形：筛选项、搜索框、原生下拉。带 data-active 时显示为已生效。 */
export const pillClass =
  "surface-chip h-11 rounded-full text-body text-foreground transition-[background-color,color,box-shadow] duration-200 ease-standard md:h-9 md:text-label";

export type NativeSelectProps = ComponentProps<"select"> & {
  /** 外层定位容器的样式，控制宽度与外边距。 */
  wrapperClassName?: string;
};

/**
 * 原生下拉：弹出的菜单由系统绘制，在 Apple 设备上就是标准的系统菜单。
 * 控件上的文字本身可识别，所以这里不用粗边框。
 */
export function NativeSelect({ className, wrapperClassName, children, ...props }: NativeSelectProps) {
  return (
    <span className={cn("relative inline-flex min-w-0 items-center", wrapperClassName)}>
      <select
        className={cn(
          pillClass,
          "w-full min-w-0 cursor-pointer appearance-none truncate border-0 pl-3.5 pr-8 outline-none",
          "disabled:cursor-not-allowed disabled:opacity-55",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-foreground-muted" aria-hidden="true" />
    </span>
  );
}

export type SearchFieldProps = Omit<InputProps, "className"> & {
  /** 结果在途时把放大镜换成转圈。 */
  pending?: boolean;
  /** 外层胶囊的样式，控制宽度。 */
  className?: string;
};

/** 胶囊搜索框。可访问名称由 aria-label 提供。 */
export function SearchField({ pending = false, className, type = "search", ...props }: SearchFieldProps) {
  return (
    <label
      className={cn(
        pillClass,
        "relative flex min-w-0 cursor-text items-center pl-9 pr-3.5",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        className,
      )}
    >
      <span className="pointer-events-none absolute left-3 flex text-foreground-muted" aria-hidden="true">
        {pending ? <Spinner /> : <Search className="h-4 w-4" />}
      </span>
      <input
        type={type}
        className="field w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-foreground-muted [&::-webkit-search-cancel-button]:appearance-none"
        {...props}
      />
    </label>
  );
}

