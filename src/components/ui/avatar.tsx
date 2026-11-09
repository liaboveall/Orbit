"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Avatar：V1 不上传头像，用姓名首字加稳定的渐变色作为占位。 */

const sizeClass = {
  sm: "h-6 w-6 text-caption",
  md: "h-8 w-8 text-label",
  lg: "h-10 w-10 text-label",
} as const;

/** 每组两端的白字对比度都不低于 4.5:1。 */
const palette = [
  "from-[#2563eb] to-[#1d4ed8]",
  "from-[#7c3aed] to-[#6d28d9]",
  "from-[#0f766e] to-[#115e59]",
  "from-[#15803d] to-[#166534]",
  "from-[#c2410c] to-[#9a3412]",
  "from-[#e11d48] to-[#be123c]",
  "from-[#64748b] to-[#475569]",
];

function hue(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}

export type AvatarProps = ComponentProps<typeof AvatarPrimitive.Root> & {
  /** 姓名（用于首字 fallback 与可访问名称）。 */
  name: string;
  src?: string | null;
  size?: keyof typeof sizeClass;
};

/** 取姓名首字母：中文取首字，英文取首字母大写。 */
function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0]?.toUpperCase() ?? "?";
}

export function Avatar({ name, src, size = "md", className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-gradient-to-b align-middle shadow-[inset_0_1px_0_rgb(255_255_255/0.28)]",
        hue(name),
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image className="h-full w-full object-cover" src={src} alt={name} />
      ) : null}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center font-medium text-white"
        aria-label={name}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/** 成员头像组：叠放显示，超出显示 +N，同时提供完整的可访问名单。 */
export function AvatarStack({
  names,
  max = 3,
  size = "md",
}: {
  names: string[];
  max?: number;
  size?: keyof typeof sizeClass;
}) {
  const shown = names.slice(0, max);
  const overflow = names.length - shown.length;
  return (
    <span className="flex items-center" aria-label={`成员：${names.join("、")}`}>
      {shown.map((name, i) => (
        <span key={`${name}-${i}`} className={cn("rounded-full", i > 0 && "-ml-2")}>
          <Avatar name={name} size={size} />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "-ml-2 inline-flex items-center justify-center rounded-full bg-surface-sunken font-medium text-foreground-secondary",
            sizeClass[size],
          )}
          aria-hidden="true"
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
