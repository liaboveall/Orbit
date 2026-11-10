import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Avatar：V1 不上传头像，用姓名首字加稳定的颜色识别成员。 */

const sizeClass = {
  sm: "h-6 w-6 text-caption",
  md: "h-8 w-8 text-label",
  lg: "h-10 w-10 text-body",
} as const;

/** 每组两端的白字对比度都不低于 4.5:1。 */
const palette = [
  ["#2b6be6", "#1d4ed8"],
  ["#8b46e8", "#6d28d9"],
  ["#0e8073", "#115e59"],
  ["#17803e", "#166534"],
  ["#cc4a12", "#9a3412"],
  ["#e11d48", "#be123c"],
  ["#c0287f", "#9d174d"],
  ["#64748b", "#475569"],
] as const;

/** FNV-1a：相近的名字也能分到不同颜色，同一个名字永远同色。 */
function colorOf(name: string): readonly [string, string] {
  let hash = 0x811c9dc5;
  for (const char of name) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return palette[(hash >>> 0) % palette.length]!;
}

export type AvatarProps = Omit<ComponentProps<"span">, "children"> & {
  /** 姓名：决定首字和颜色。头像本身是装饰，名字由相邻文本或 title 提供。 */
  name: string;
  size?: keyof typeof sizeClass;
};

export function Avatar({ name, size = "md", className, style, ...props }: AvatarProps) {
  const [from, to] = colorOf(name);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full align-middle font-medium text-white",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_0_0_0.5px_rgb(0_0_0/0.12)]",
        sizeClass[size],
        className,
      )}
      style={{ backgroundImage: `linear-gradient(180deg, ${from}, ${to})`, ...style }}
      {...props}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
