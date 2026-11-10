import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { OrbitWordmark } from "@/features/shell/orbit-logo";
import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";

/**
 * 认证页面共用的外壳：居中的一片玻璃卡片，上方是字标，背后是两条轨道线。
 * 登录、注册、找回密码、邮箱验证和邀请页都用它。
 *
 * 表单提交后换成结果说明（AuthNotice）时，卡片里的静态标题自动隐藏，
 * 由结果说明自己的标题充当页面标题，不出现两个标题。
 */
export function AuthShell({
  title,
  description,
  children,
  className,
}: {
  /** 页面标题（h1）。内容自带标题的页面（邮箱验证、邀请）不传。 */
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <AuthBackdrop />
      <div className={cn("relative w-full max-w-[420px] animate-rise", className)}>
        <div className="mb-6 flex justify-center">
          <Link href="/" aria-label="Orbit 首页" className="rounded-control outline-none">
            <OrbitWordmark />
          </Link>
        </div>
        <div data-lens="" className="group/card glass rounded-panel p-6 sm:p-8">
          {title || description ? (
            <header className="mb-6 space-y-1.5 group-has-[[data-auth-notice]]/card:hidden">
              {title ? (
                <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em] text-foreground">{title}</h1>
              ) : null}
              {description ? (
                <p className="text-label leading-relaxed text-foreground-secondary">{description}</p>
              ) : null}
            </header>
          ) : null}
          {children}
        </div>
      </div>
    </main>
  );
}

/** 表单加载时的占位，尺寸与表单相近，卡片不跳动。 */
export function AuthFormFallback() {
  return (
    <SkeletonBlock label="加载表单中" className="space-y-4">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full rounded-full" />
    </SkeletonBlock>
  );
}

/** 两条轨道的路径：与字标里的轨道同一倾角，行星沿外圈缓慢运行。 */
const OUTER_ORBIT = "M 40 400 a 360 150 0 1 0 720 0 a 360 150 0 1 0 -720 0";

/** 背景装饰：倾斜的轨道线和一颗行星，呼应字标。纯装饰，不拦截交互。 */
function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg
        viewBox="0 0 800 800"
        fill="none"
        className="absolute left-1/2 top-1/2 h-[150vmin] min-h-[720px] w-[150vmin] min-w-[720px] -translate-x-1/2 -translate-y-1/2"
      >
        <g transform="rotate(-28 400 400)">
          <ellipse cx="400" cy="400" rx="360" ry="150" className="stroke-line" strokeWidth="1.5" />
          <ellipse cx="400" cy="400" rx="250" ry="104" className="stroke-line" strokeWidth="1.5" opacity="0.6" />
          <circle r="6" className="orbit-planet fill-brand" opacity="0.55" style={{ offsetPath: `path("${OUTER_ORBIT}")` }} />
        </g>
      </svg>
    </div>
  );
}
