import { cn } from "@/lib/cn";

/**
 * Orbit 自有字标与轨道图形（ORB-002）。
 *
 * docs/02 §1：自行绘制 Orbit 字标/简洁轨道线图形，不使用他人品牌素材。
 * 图形为中心星 + 倾斜轨道环 + 轨道上的行星，纯 SVG（currentColor 继承文字色）。
 */

/** 轨道标记（无文字）。 */
export function OrbitMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("h-6 w-6", className)}
    >
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="6.5"
        stroke="currentColor"
        strokeWidth="2"
        transform="rotate(-28 16 16)"
        opacity="0.55"
      />
      <circle cx="16" cy="16" r="4.6" fill="currentColor" />
      <circle cx="28.4" cy="9.4" r="2.4" fill="currentColor" />
    </svg>
  );
}

/** 字标：轨道标记 + 「Orbit」文字。collapsed 时只保留标记（平板/窄侧栏）。 */
export function OrbitWordmark({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2 text-brand", className)}>
      <OrbitMark className="h-7 w-7 shrink-0" />
      <span
        className={cn(
          "text-section font-semibold tracking-tight text-foreground",
          collapsed && "hidden xl:inline",
        )}
      >
        Orbit
      </span>
    </span>
  );
}
