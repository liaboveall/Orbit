import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { DiscussionSpecimen, FocusSpecimen, ProgressSpecimen } from "@/features/landing/feature-specimens";
import { ProductPreview } from "@/features/landing/product-preview";
import { OrbitWordmark } from "@/features/shell/orbit-logo";

/**
 * 介绍页：一句主张、一屏界面预览、三项功能、开始使用。
 * 预览和配图都由真实组件渲染，没有图片资源。
 */

const FEATURES: { title: string; body: string; specimen: ReactNode }[] = [
  {
    title: "看清进度",
    body: "看板和列表是同一批任务的两种视图。负责人、优先级和截止日一眼可见，拖拽或用键盘都能移动卡片。",
    specimen: <ProgressSpecimen />,
  },
  {
    title: "围绕任务协作",
    body: "在任务下写描述、拆子任务、评论和上传私有附件。发一条一次性链接，就能邀请队友加入。",
    specimen: <DiscussionSpecimen />,
  },
  {
    title: "专注下一步",
    body: "工作台汇集跨项目的待办和到期事项。编辑冲突时保留草稿，误删的任务可以从回收站恢复。",
    specimen: <FocusSpecimen />,
  },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-3 z-20 flex justify-center px-4">
        <div
          data-lens=""
          className="glass flex w-full max-w-3xl items-center justify-between gap-2 rounded-full py-1.5 pl-5 pr-1.5"
        >
          <Link href="/" aria-label="Orbit 首页" className="rounded-control outline-none">
            <OrbitWordmark />
          </Link>
          <nav aria-label="账户" className="flex items-center gap-1">
            <Link href="/auth/login" className={buttonVariants({ variant: "ghost", size: "sm", className: "max-sm:h-9" })}>
              登录
            </Link>
            <Link href="/auth/register" className={buttonVariants({ size: "sm", className: "max-sm:h-9" })}>
              免费开始
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl animate-rise px-6 pt-16 text-center md:pt-24">
          <p className="text-title font-medium text-brand-ink md:text-section">有序 Orbit</p>
          <h1 className="mt-3 text-hero font-semibold tracking-[-0.022em] text-foreground">
            让小团队的项目，
            <br />
            有序向前。
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-title leading-relaxed text-foreground-secondary md:text-section md:leading-relaxed">
            把任务、讨论和交付成果放在一起。
            <br className="max-sm:hidden" />
            谁在做什么，下一步做什么，一眼看清。
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/auth/register" className={buttonVariants({ size: "lg", className: "h-12 px-7" })}>
              免费开始
            </Link>
            <Link href="/demo" className={buttonVariants({ variant: "secondary", size: "lg", className: "h-12 px-7" })}>
              体验只读演示
            </Link>
          </div>
        </section>

        <figure className="mx-auto mt-14 max-w-[1200px] animate-rise px-3 [animation-delay:120ms] md:mt-20 md:px-6">
          <ProductPreview />
          <figcaption className="mt-3 text-center text-caption text-foreground-muted">
            界面预览 · 合成演示数据
          </figcaption>
        </figure>

        <section aria-labelledby="features-title" className="mx-auto max-w-[1152px] px-4 pt-24 md:px-6 md:pt-32">
          <h2
            id="features-title"
            className="text-center text-[clamp(28px,1.2rem+2vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-foreground"
          >
            从分工到交付，都在这里。
          </h2>
          <div className="mx-auto mt-10 grid max-w-xl gap-3 md:mt-14 lg:max-w-none lg:grid-cols-3 lg:gap-4">
            {FEATURES.map(({ title, body, specimen }) => (
              <article key={title} className="surface-card flex flex-col rounded-card p-5 md:p-6">
                <div className="flex flex-col justify-center lg:min-h-[172px]">{specimen}</div>
                <h3 className="mt-6 text-section font-semibold tracking-[-0.015em] text-foreground">{title}</h3>
                <p className="mt-2 text-label leading-relaxed text-foreground-secondary">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="start-title" className="mx-auto max-w-[1152px] px-4 pb-10 pt-20 md:px-6 md:pt-28">
          <div className="glass rounded-[32px] px-6 py-12 text-center md:py-16">
            <h2
              id="start-title"
              className="text-[clamp(26px,1.1rem+1.8vw,40px)] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground"
            >
              从第一项任务开始。
            </h2>
            <p className="mx-auto mt-3 max-w-md text-balance text-body leading-relaxed text-foreground-secondary">
              注册只需要一个邮箱。验证后就能创建项目，把队友请进来。
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/auth/register" className={buttonVariants({ size: "lg", className: "h-12 px-7" })}>
                创建账户
              </Link>
              <Link href="/auth/login" className={buttonVariants({ variant: "secondary", size: "lg", className: "h-12 px-7" })}>
                登录
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1152px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 pb-10 pt-4 text-caption text-foreground-muted md:px-8">
        <p>有序 Orbit · 为个人和学生小团队打造的项目协作空间</p>
        <Link href="/demo" className="rounded-[6px] text-foreground-secondary underline-offset-4 outline-none hover:text-foreground hover:underline">
          只读演示
        </Link>
      </footer>
    </div>
  );
}
