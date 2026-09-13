"use client";

import { LogOut, Settings } from "lucide-react";
import type { UserDTO } from "@/contracts";
import { useToast } from "@/components/ui/toast";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@/components/ui";
import { Avatar } from "@/components/ui/avatar";
import { useSignOut } from "@/features/auth/use-auth";
import { useGuardedNavigate } from "@/features/tasks/unsaved-changes";

/**
 * 个人菜单（M1 / ORB-006）：AppShell 侧栏底部与平板 rail 态的用户入口。
 *
 * ORB-006 变更：
 *  - 用户信息改为 `user` prop（layout 用 getSessionUser 取真实会话后经 AppShell 传入），
 *    不再引用 fixture 的 CURRENT_USER —— 姓名/邮箱/时区都是账户真实数据；
 *  - 「个人设置」从占位 toast 改为真实导航 `router.push("/app/settings")`；
 *  - 「退出登录」保持整页硬跳转（`window.location.assign`）：signOut 清除 httpOnly 会话
 *    cookie 后，硬跳转同时销毁全部客户端内存态（React 状态、模块级缓存、表单草稿），
 *    这是验收标准 #3「退出/换账号不泄露上一账户私有缓存」的关键一环；
 *    服务端侧再由 /me 的 `Cache-Control: private, no-store` 保证浏览器/共享缓存不留副本。
 *
 * 边界：客户端组件，只依赖 @/components/ui、@/features/auth 与 @/contracts（均客户端安全），
 * 不导入 @/server。
 */

type UserMenuVariant = "settings" | "avatar";

type UserMenuProps = {
  /** settings：展开/抽屉态的齿轮按钮；avatar：rail 收起态的头像按钮。 */
  variant: UserMenuVariant;
  /** 当前会话用户（真实数据，来自服务端 layout）。 */
  user: UserDTO;
  /** 菜单弹出方向（底部侧栏默认向上/向右）。 */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
};

export function UserMenu({
  variant,
  user,
  side = "top",
  align = "start",
}: UserMenuProps) {
  // B6 修复：程序化导航同样受未保存草稿保护。
  const guardedNavigate = useGuardedNavigate();
  const { signOut, pending, error: signOutError } = useSignOut();
  const { toast } = useToast();
  const [signOutPromise, setSignOutPromise] = useState<Promise<{ error?: string }> | null>(null);

  async function handleSignOut(): Promise<void> {
    if (signOutPromise) return; // Already in progress
    
    const promise = signOut();
    setSignOutPromise(promise);
    
    try {
      const result = await promise;
      if (result?.error) {
        // Sign out failed - show error toast and don't navigate
        toast({
          title: "退出失败",
          description: signOutError || "退出失败，请稍后再试",
          variant: "danger",
          duration: 4000,
        });
        return;
      }
      // Successful sign out - redirect to login page
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/auth/login");
    } finally {
      setSignOutPromise(null);
    }
  }

  function handleSettings(): void {
    // 客户端软导航即可：设置页由服务端读取会话与账户档案（force-dynamic），
    // 每次进入都拿到最新数据，不存在跨账号的客户端缓存残留。
    guardedNavigate.push("/app/settings");
  }

  const trigger =
    variant === "avatar" ? (
      <button
        type="button"
        aria-label={`${user.name} · 账户菜单`}
        className="flex h-10 w-full items-center justify-center rounded-control outline-none hover:bg-surface-sunken data-[state=open]:bg-surface-sunken"
      >
        <Avatar name={user.name} size="md" />
      </button>
    ) : (
      <IconButton label="账户菜单" size="sm">
        <Settings className="h-4 w-4" />
      </IconButton>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="min-w-60">
        <DropdownMenuLabel className="space-y-1">
          <span className="flex items-center gap-2">
            <Avatar name={user.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-medium text-foreground">
                {user.name}
              </span>
              <span className="block truncate text-caption font-normal text-foreground-muted">
                {user.email}
              </span>
            </span>
          </span>
          <span className="block truncate font-mono text-caption font-normal text-foreground-muted">
            {user.timezone}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            handleSettings();
          }}
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          个人设置
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
          className="text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {pending ? "正在退出…" : "退出登录"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
