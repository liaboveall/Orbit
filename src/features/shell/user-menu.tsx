"use client";

import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { useRef } from "react";
import type { UserDTO } from "@/contracts";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
} from "@/components/ui";
import { useSignOut } from "@/features/auth/use-auth";
import { clearUserDrafts } from "@/features/tasks/draft-storage";
import { confirmLeave, navigateAfterConfirmedLeave, useGuardedNavigate } from "@/features/tasks/unsaved-changes";
import { cn } from "@/lib/cn";

/**
 * 账户入口：侧栏底部的一行，点开是个人设置和退出登录。
 *
 * 退出登录走整页跳转：清除会话后先删除该用户的本机草稿，再销毁全部客户端内存态，
 * 保证换账号不会看到上一个账户的内容。退出失败时草稿原样保留。
 */
export function UserMenu({
  user,
  collapsible = false,
  active = false,
}: {
  user: UserDTO;
  /** 收窄的侧栏里只显示头像，宽屏再展开姓名。 */
  collapsible?: boolean;
  /** 当前在个人设置页。 */
  active?: boolean;
}) {
  // 程序化导航同样受未保存草稿保护。
  const guardedNavigate = useGuardedNavigate();
  const { signOut, pending } = useSignOut();
  const { toast } = useToast();
  const signingOut = useRef(false);

  async function handleSignOut(): Promise<void> {
    if (signingOut.current || !confirmLeave()) return;
    signingOut.current = true;
    try {
      const result = await signOut();
      if (result?.error) {
        toast({ title: "退出失败", description: result.error, variant: "danger" });
        return;
      }
      clearUserDrafts(user.id);
      navigateAfterConfirmedLeave("/auth/login");
    } finally {
      signingOut.current = false;
    }
  }

  const detail = cn("min-w-0 flex-1 text-left", collapsible && "hidden xl:block");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="账户菜单"
          title={user.name}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-item p-1.5 outline-none",
            "transition-[background-color,transform] duration-200 ease-standard active:scale-[0.98]",
            "hover:bg-surface-sunken data-[state=open]:bg-surface-sunken",
            collapsible && "max-xl:justify-center",
            active && "surface-selected hover:bg-[var(--selected-fill)]",
          )}
        >
          <Avatar name={user.name} size="md" />
          <span className={detail}>
            <span className="block truncate text-label font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-caption text-foreground-muted">{user.email}</span>
          </span>
          <ChevronsUpDown
            className={cn("mr-1 h-4 w-4 shrink-0 text-foreground-muted", collapsible && "hidden xl:block")}
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-60">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
          <Avatar name={user.name} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-caption font-normal text-foreground-muted">{user.email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => guardedNavigate.push("/app/settings")}>
          <Settings className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
          个人设置
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {pending ? "正在退出…" : "退出登录"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
