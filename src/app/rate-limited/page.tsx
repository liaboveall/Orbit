import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OrbitMark } from "@/features/shell/orbit-logo";
import { parseRateLimitedParams } from "@/lib/rate-limited";

/**
 * 读取超额说明页（PAGE-READ-LIMIT）：页面请求超过每用户读取额度时由准入函数跳转至此。
 * 不读取会话或数据库，不在 /app 下，避免继续消耗额度；只显示等待时间与返回原页面的入口。
 */

export const metadata: Metadata = { title: "请求过于频繁 · Orbit" };
export const dynamic = "force-dynamic";

export default async function RateLimitedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { retryAfter, returnTo } = parseRateLimitedParams(await searchParams);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 py-16">
      <OrbitMark className="h-9 w-9 text-brand" />
      <EmptyState
        className="w-full max-w-lg"
        icon={<Clock className="h-6 w-6" />}
        title="请求过于频繁"
        description={`为保护服务，读取请求暂时受限。请约 ${retryAfter} 秒后重试；已保存的数据不受影响。`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={returnTo} className={buttonVariants({})}>
              重试
            </Link>
            <Link href="/app/today" className={buttonVariants({ variant: "secondary" })}>
              返回工作台
            </Link>
          </div>
        }
      />
    </main>
  );
}
