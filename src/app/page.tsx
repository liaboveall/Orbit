import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { OrbitMark } from "@/features/shell/orbit-logo";
import { BOARD_PROJECT } from "@/features/shell/fixtures";
import { PRIMARY_TASK } from "@/features/tasks/fixtures";

/**
 * Orbit 首页（M0）。
 *
 * ORB-001 工程基线说明 + ORB-002 布局样例入口。
 * 样例路由（/app/*）仅开发环境渲染实际内容（见 /app 布局的开发闸门），
 * 因此这里的样例链接也只在 NODE_ENV=development 下展示。样式全部消费 tokens。
 */

const isDev = process.env.NODE_ENV === "development";

export default function HomePage() {
  const boardHref = `/app/projects/${BOARD_PROJECT.id}/board`;
  const detailHref = `/app/projects/${BOARD_PROJECT.id}/tasks/${PRIMARY_TASK.id}`;

  const samples = [
    { href: "/app/today", label: "我的工作台" },
    { href: boardHref, label: "看板" },
    { href: `${boardHref}?task=${PRIMARY_TASK.id}`, label: "看板 + 详情侧面板" },
    { href: detailHref, label: "任务详情（独立页）" },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 bg-background px-6 py-16">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-2 text-brand">
          <OrbitMark className="h-6 w-6" />
          <span className="text-caption font-medium uppercase tracking-[0.2em]">
            Milestone M0
          </span>
        </span>
        <h1 className="text-hero font-semibold tracking-tight text-foreground">
          Orbit 工程基线
        </h1>
        <p className="text-body leading-relaxed text-foreground-secondary">
          Next.js 16 App Router + TypeScript strict + Tailwind CSS 4 + Prisma 7 脚手架已就绪。
          设计 tokens、基础组件与三页布局样例见 ORB-002。
        </p>
      </header>

      <ul className="grid gap-2 text-label text-foreground-secondary">
        <li className="rounded-card border border-line bg-surface px-4 py-3">
          命令契约：dev / build / start / lint / typecheck / test:* / db:* / check
        </li>
        <li className="rounded-card border border-line bg-surface px-4 py-3">
          环境变量在服务启动期由 Zod 校验，错误只报变量名与预期格式。
        </li>
      </ul>

      <section className="space-y-3">
        <h2 className="text-section font-semibold text-foreground">开始使用</h2>
        <p className="text-label text-foreground-secondary">
          创建账户后即可管理项目、任务与看板。已有账户？
          <Link
            href="/auth/login"
            className="mx-1 font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            登录
          </Link>
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/auth/register" className={buttonVariants({ variant: "primary" })}>
            开始使用
          </Link>
        </div>
      </section>

      {isDev ? (
        <section className="space-y-3">
          <h2 className="text-section font-semibold text-foreground">
            布局样例（仅开发环境）
          </h2>
          <p className="text-label text-foreground-secondary">
            使用 fixture 合成数据，未连接真实后端。进入后可用右下角面板或 URL 的
            <code className="mx-1 rounded bg-surface-sunken px-1 font-mono text-caption">
              ?state=
            </code>
            切换 loading / empty / error / permission / long-content 各态（默认正常数据态）。
          </p>
          <div className="flex flex-wrap gap-3">
            {samples.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className={buttonVariants({ variant: "secondary" })}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
