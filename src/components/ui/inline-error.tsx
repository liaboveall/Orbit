import type { ComponentProps, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * InlineError（ORB-002）：字段旁/局部区域内的错误提示。
 *
 * docs/02 §7 与任务规格要求：错误反馈不能只靠 Toast，必须有驻留的局部提示。
 * 默认 role="alert" 让屏幕阅读器即时宣告；配 danger 图标 + 文案（不单靠颜色）。
 */

export type InlineErrorProps = Omit<ComponentProps<"div">, "children"> & {
  children?: ReactNode;
  /** 传入 id 时可被控件的 aria-describedby 引用。 */
  id?: string;
};

export function InlineError({
  children,
  className,
  id,
  ...props
}: InlineErrorProps) {
  if (!children) return null;
  return (
    <div
      id={id}
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-label text-danger",
        className,
      )}
      {...props}
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
