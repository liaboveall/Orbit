import { cn } from "@/lib/cn";

/** Orbit 自有字标：中心星、倾斜轨道环和轨道上的行星，纯 SVG，继承文字色。 */

export function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("h-6 w-6", className)}>
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="6.5"
        stroke="currentColor"
        strokeWidth="2"
        transform="rotate(-28 16 16)"
        opacity="0.5"
      />
      <circle cx="16" cy="16" r="4.6" fill="currentColor" />
      <circle cx="28.4" cy="9.4" r="2.4" fill="currentColor" />
    </svg>
  );
}

/** 字标：轨道标记加「Orbit」文字。collapsed 时在窄侧栏只保留标记。 */
export function OrbitWordmark({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2 text-brand-ink", className)}>
      <OrbitMark className="h-7 w-7 shrink-0" />
      <span
        className={cn(
          "text-[19px] font-semibold tracking-[-0.02em] text-foreground",
          collapsed && "hidden xl:inline",
        )}
      >
        Orbit
      </span>
    </span>
  );
}
