"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Avatar（ORB-002，基于 @radix-ui/react-avatar）。
 *
 * V1 不上传头像（docs/01 §3）：用姓名首字母占位。Root 处理图片加载/回退，
 * Fallback 显示首字母，保证无图时仍有可辨识、可读的占位。
 */

const sizeClass = {
  sm: "h-6 w-6 text-caption",
  md: "h-8 w-8 text-label",
  lg: "h-10 w-10 text-label",
} as const;

export type AvatarProps = ComponentProps<typeof AvatarPrimitive.Root> & {
  /** 姓名（用于生成首字母 fallback 与可访问名称）。 */
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

export function Avatar({
  name,
  src,
  size = "md",
  className,
  ...props
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-brand-soft align-middle",
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image
          className="h-full w-full object-cover"
          src={src}
          alt={name}
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center font-medium text-brand"
        aria-label={name}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/**
 * 成员头像占位组：多个 Avatar 叠加，超出显示 +N（看板/项目页头用）。
 * 提供可访问的完整成员名称列表（不只靠视觉头像）。
 */
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
    <span
      className="flex items-center"
      aria-label={`成员：${names.join("、")}`}
    >
      {shown.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className={cn(i > 0 && "-ml-2 ring-2 ring-surface rounded-full")}
        >
          <Avatar name={name} size={size} />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "-ml-2 inline-flex items-center justify-center rounded-full bg-surface-sunken font-medium text-foreground-secondary ring-2 ring-surface",
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
