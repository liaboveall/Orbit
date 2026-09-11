import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { OrbitWordmark } from "@/features/shell/orbit-logo";
import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";

/**
 * 认证页面共享外壳（M1 / ORB-005）。
 *
 * 设计（docs/02 + 任务规格）：居中卡片、Orbit 字标、简洁背景。为在 token 体系内做出
 * Orbit 辨识度，背景叠加两处极淡的品牌光晕与一条倾斜轨道环（呼应 OrbitMark 的椭圆轨道），
 * 全部用 tokens 的 CSS 变量（--color-brand-soft / --color-line），不引入外部素材或额外字体。
 *
 * 无 "use client"：作为服务端组件承载静态布局，表单本身是各自的客户端组件子节点。
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  className,
}: {
  /** 页面标题（h1）。状态化页面（验证/重设/注册/找回）可省略，由内部各状态自管标题。 */
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <AuthBackdrop />
      <div className={cn("relative w-full max-w-md", className)}>
        <div className="mb-7 flex justify-center">
          <OrbitWordmark className="text-brand" />
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-popover sm:p-8">
          {title || description ? (
            <header className="mb-6 space-y-1.5">
              {title ? (
                <h1 className="text-page font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
              ) : null}
              {description ? (
                <p className="text-label leading-relaxed text-foreground-secondary">
                  {description}
                </p>
              ) : null}
            </header>
          ) : null}
          {children}
        </div>
        {footer ? (
          <div className="mt-5 text-center text-label text-foreground-secondary">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * 表单 Suspense 回退：认证表单是客户端组件（部分用 useSearchParams，需 Suspense 边界）。
 * 加载时用与表单同形的骨架占位，保持卡片尺寸稳定（docs/02 §4）。
 */
export function AuthFormFallback() {
  return (
    <SkeletonBlock label="加载表单中" className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-11 w-full" />
    </SkeletonBlock>
  );
}

/** 背景装饰：两处柔和品牌光晕 + 一条倾斜轨道环（纯装饰，aria-hidden，不拦截交互）。 */
function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,var(--color-brand-soft),transparent_68%)] opacity-90 blur-2xl" />
      <div className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-[radial-gradient(circle,var(--color-brand-soft),transparent_70%)] opacity-70 blur-2xl" />
      <svg
        viewBox="0 0 800 800"
        fill="none"
        className="absolute left-1/2 top-1/2 h-[140vmin] w-[140vmin] -translate-x-1/2 -translate-y-1/2 text-line"
      >
        <ellipse
          cx="400"
          cy="400"
          rx="360"
          ry="150"
          stroke="currentColor"
          strokeWidth="1.5"
          transform="rotate(-28 400 400)"
          opacity="0.5"
        />
        <ellipse
          cx="400"
          cy="400"
          rx="260"
          ry="108"
          stroke="currentColor"
          strokeWidth="1.5"
          transform="rotate(-28 400 400)"
          opacity="0.35"
        />
      </svg>
    </div>
  );
}
