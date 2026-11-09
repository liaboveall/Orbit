import Image from "next/image";
import Link from "next/link";
import { Kanban, MessagesSquare, ShieldCheck, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { OrbitWordmark } from "@/features/shell/orbit-logo";

const FEATURES: { title: string; body: string; icon: LucideIcon }[] = [
  { title: "看清进度", body: "用列表与看板拆分任务，明确负责人和截止日期。", icon: Kanban },
  { title: "协作有上下文", body: "子任务、评论和私有附件，让讨论围绕任务展开。", icon: MessagesSquare },
  { title: "变更有保障", body: "多人编辑时提示冲突，保留草稿，失败可以重试。", icon: ShieldCheck },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-3 z-20 flex justify-center px-4">
        <div className="glass flex w-full max-w-3xl items-center justify-between rounded-full py-1.5 pl-4 pr-1.5">
          <Link href="/" aria-label="Orbit 首页" className="rounded-[10px] outline-none">
            <OrbitWordmark />
          </Link>
          <Link href="/auth/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            登录
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl animate-rise px-6 pt-20 text-center md:pt-28">
          <p className="text-[19px] font-medium text-brand-ink">有序 Orbit</p>
          <h1 className="mt-3 text-hero font-semibold tracking-[-0.02em] text-foreground">
            让小团队的项目，
            <br />
            有序向前。
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[19px] leading-relaxed text-foreground-secondary">
            从第一项任务到最后一份成果，把计划、进度、讨论和文件放在同一个地方。
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/auth/register" className={buttonVariants({ size: "lg" })}>
              创建账户
            </Link>
            <Link href="/demo" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              体验只读演示
            </Link>
          </div>
        </section>

        <figure className="mx-auto mt-16 max-w-6xl px-4 md:mt-20">
          <div className="glass rounded-[32px] p-2 md:p-2.5">
            <Image
              src="/screenshots/demo.png"
              alt="Orbit 只读演示的实际页面截图：任务按待办、进行中和已完成分列"
              width={1440}
              height={900}
              priority
              className="h-auto w-full rounded-[24px]"
            />
          </div>
          <figcaption className="mt-3 text-center text-caption text-foreground-muted">
            实际页面截图 · 合成演示数据
          </figcaption>
        </figure>

        <section aria-label="核心功能" className="mx-auto grid max-w-5xl gap-3 px-4 pb-24 pt-20 md:grid-cols-3">
          {FEATURES.map(({ title, body, icon: Icon }) => (
            <article key={title} className="glass-card rounded-card p-6">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
              >
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-section font-semibold tracking-[-0.015em]">{title}</h2>
              <p className="mt-2 text-label leading-relaxed text-foreground-secondary">{body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
