import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OrbitMark } from "@/features/shell/orbit-logo";

/**
 * 统一「未找到 / 不可访问」页面（ORB-002）。
 *
 * docs/02 §7：无权限与不存在使用同一外观，不泄露资源是否存在或项目名称。
 * 未匹配路由（404）与详情页 notFound() 均落到此处。
 * 该页在根布局下渲染（不含 AppShell / AppProviders），故不依赖 useToast 等客户端上下文，
 * 保持纯 Server Component 以避免 Provider 缺失报错。
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16">
      <OrbitMark className="h-9 w-9 text-brand-ink" />
      <EmptyState
        className="w-full max-w-lg"
        icon={<Compass className="h-6 w-6" />}
        title="无法访问此页面"
        description="它可能不存在，或你没有访问权限。为避免泄露信息，我们不会区分这两种情况。"
        action={
          <Link
            href="/app/today"
            className={buttonVariants({ variant: "secondary" })}
          >
            返回工作台
          </Link>
        }
      />
    </main>
  );
}
