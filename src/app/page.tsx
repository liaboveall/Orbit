import Link from "next/link";
import Image from "next/image";
import { buttonVariants } from "@/components/ui/button";
import { OrbitMark } from "@/features/shell/orbit-logo";
export default function HomePage() {
  return <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-10 px-6 py-16">
    <header className="space-y-6"><div className="flex items-center gap-3 text-brand"><OrbitMark className="h-8 w-8"/><span>有序 Orbit</span></div><h1 className="text-hero font-semibold tracking-tight">让小团队的项目，<br/>有序向前。</h1><p className="max-w-2xl text-body text-foreground-secondary">从第一项任务到最后一份成果，把计划、进度、讨论和文件放在同一个地方。为个人和学生小团队设计。</p></header>
    <div className="flex flex-wrap gap-3"><Link href="/auth/register" className={buttonVariants({variant:"primary"})}>创建账户</Link><Link href="/demo" className={buttonVariants({variant:"secondary"})}>体验只读演示</Link><Link href="/auth/login" className={buttonVariants({variant:"ghost"})}>登录</Link></div>
    <section className="grid gap-5 md:grid-cols-3" aria-label="核心功能">{[["看清进度","用列表与看板拆分任务，明确负责人和截止日期。"],["协作有上下文","子任务、评论和私有附件，让讨论围绕任务展开。"],["变更有保障","多人编辑时提示冲突，保留草稿，失败可以重试。"]].map(([title,body])=><article key={title} className="rounded-card border border-line bg-surface p-6"><h2 className="text-section font-semibold">{title}</h2><p className="mt-3 text-foreground-secondary">{body}</p></article>)}</section>
    <figure className="overflow-hidden rounded-card border border-line"><Image src="/screenshots/demo.png" alt="Orbit 只读演示的实际页面截图：任务按待办、进行中和已完成分列" width={1440} height={2216} className="max-h-[540px] w-full object-cover object-top"/><figcaption className="bg-surface p-3 text-caption text-foreground-secondary">实际页面截图 · 合成演示数据</figcaption></figure>
    <p className="text-caption text-foreground-secondary">演示使用合成数据，无需登录。真实项目仅对已授权成员开放。</p>
  </main>;
}
