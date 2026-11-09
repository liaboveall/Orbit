import type { ProjectColor } from "@/contracts";
import { cn } from "@/lib/cn";
import { PROJECT_COLOR_DOT } from "@/lib/project-color";

const sizeClass = {
  xs: "h-5 w-5 rounded-[6px] text-[11px]",
  sm: "h-6 w-6 rounded-[7px] text-caption",
  md: "h-10 w-10 rounded-[12px] text-body",
  lg: "h-12 w-12 rounded-[14px] text-section",
} as const;

/** 项目图标：标记色圆角方块加项目名首字，装饰性，名称由相邻文本提供。 */
export function ProjectGlyph({
  name,
  color,
  size = "sm",
  className,
}: {
  name: string;
  color: ProjectColor;
  size?: keyof typeof sizeClass;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.32),0_1px_2px_rgb(0_0_0/0.14)]",
        PROJECT_COLOR_DOT[color],
        sizeClass[size],
        className,
      )}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
