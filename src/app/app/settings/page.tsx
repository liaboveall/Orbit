import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { UserDTO } from "@/contracts";
import { SettingsForm } from "@/features/settings/settings-form";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { readUserById } from "@/server/me/read-user";

/**
 * /app/settings —— 个人设置（M1 / ORB-006）。
 *
 * docs/02 §3 路由表：`/app/settings | 姓名与时区 | 登录`。
 *
 * 服务端组件（无 "use client"）负责**权威数据读取**：
 *  1. `requirePageUser()` 取会话用户并消费一次读取额度；未认证 → 带 returnTo 的登录页，读取超额 → 限流说明页
 *     （proxy 已保护 /app/*，这里是第二道防线：组件重定向只是体验，数据安全在服务端）；
 *  2. `readUserById` **直接查库**取最新档案，而不是复用会话快照 —— 与 GET /me 同源，
 *     保证 PATCH 后刷新页面立即看到新值（验收标准 #1）；
 *  3. 把 UserDTO 作为初值传给客户端表单，首屏即有真实数据（无骨架等待、无客户端二次拉取）。
 *
 * 缓存：本页读取 headers() 属动态渲染，另显式声明 force-dynamic，避免任何层缓存私有档案。
 */

export const metadata: Metadata = { title: "个人设置" };
export const dynamic = "force-dynamic";

const SETTINGS_PATH = "/app/settings";

export default async function SettingsPage() {
  const sessionUser = await requirePageUser();

  let user: UserDTO;
  try {
    user = await readUserById(sessionUser.id);
  } catch (error) {
    // 会话有效但用户行已不存在（并发删除）：回到登录页而非抛错页。
    if (error instanceof DomainError && error.code === "NOT_FOUND") {
      redirect(loginPathWithReturnTo(SETTINGS_PATH));
    }
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <p className="font-mono text-caption uppercase tracking-[0.18em] text-foreground-muted">
          account · /api/v1/me
        </p>
        <h1 className="mt-1 text-page font-semibold tracking-tight text-foreground">
          个人设置
        </h1>
        <p className="mt-1.5 max-w-2xl text-label leading-relaxed text-foreground-secondary">
          姓名会出现在任务分配、评论与项目成员列表中；时区决定「逾期 / 今天到期 /
          未来 7 天」的日期边界。保存后立即生效，刷新页面仍然保留。
        </p>
      </header>

      <SettingsForm user={user} />
    </div>
  );
}
