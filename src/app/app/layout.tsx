import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppProviders } from "@/features/shell/providers";
import { AppShell } from "@/features/shell/app-shell";
import { StateSwitcher } from "@/features/shell/state-switcher";
import { DEFAULT_RETURN_TO, REQUEST_RETURN_TO_HEADER, loginPathWithReturnTo } from "@/lib/return-to";
import { getSessionUser } from "@/server/auth/session";

/**
 * /app 布局（M1 / ORB-006：由「开发样例门禁」改为「真实会话外壳」）。
 *
 * 变更理由：ORB-006 引入 `/app/settings`（读写真实账户数据）与 `GET/PATCH /api/v1/me`，
 * /app/* 不再是纯 fixture 样例区，因此移除原先 `NODE_ENV !== "development"` 的整段门禁
 * （那会让生产环境的个人设置页只显示「仅开发环境可见」）。
 *
 * 现在的门禁模型（docs/03 §5：数据安全在服务端授权，组件重定向只是体验）：
 *  1. `src/proxy.ts` 按 session cookie 是否存在快速拦截 /app/*（未登录→登录页）；
 *  2. 本布局用 `getSessionUser(await headers())` 做**权威**会话校验（cookie 存在≠会话有效，
 *     伪造/过期/已撤销的 cookie 在这里被拒），失败即 redirect 到带 returnTo 的登录页；
 *  3. 校验通过后把真实 UserDTO 传给 AppShell，顶栏时区、侧栏姓名、个人菜单全部来自会话，
 *     不再引用 fixture 的 CURRENT_USER（该 fixture 仅留给 today/board/task 样例页，M2 替换）。
 *
 * 缓存（验收标准 #3）：读取 headers() 使本布局动态渲染，另显式 force-dynamic，
 * 确保账户私有信息不进任何共享缓存；退出登录用整页硬跳转（见 user-menu.tsx），
 * 天然清空客户端内存态，换账号不会读到上一账户的渲染结果。
 *
 * 开发样例工具（右下角六态切换面板）仅在 development 渲染：NODE_ENV 是构建期常量，
 * 生产构建会把该分支作为死代码消除，不向真实用户暴露开发工具。
 */

export const dynamic = "force-dynamic";

const isDev = process.env.NODE_ENV === "development";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const user = await getSessionUser(requestHeaders);
  if (!user) redirect(loginPathWithReturnTo(requestHeaders.get(REQUEST_RETURN_TO_HEADER) ?? DEFAULT_RETURN_TO));

  return (
    <AppProviders>
      <AppShell user={user}>{children}</AppShell>
      {isDev ? <StateSwitcher /> : null}
    </AppProviders>
  );
}
