"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, UserMinus, Users } from "lucide-react";
import { ErrorResponseSchema, type MemberDTO } from "@/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineError } from "@/components/ui/inline-error";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/features/auth/auth-form";
import { loginPathWithReturnTo } from "@/lib/return-to";

/**
 * 项目成员列表（M4 / ORB-014，`/app/projects/[id]/members`）。
 *
 * 首屏 MemberDTO[] 由 Server Component 直调 listMembers 取得后经 props 传入；
 * 移除/退出成功后：移除他人 → `router.refresh()` 重读列表；退出本项目 → 硬跳转
 * `/app/projects`（已非成员，不能再停留在本项目任何页面）。
 *
 * 授权（docs/05 §4，服务端 removeMember 权威复核）：
 *  - owner 可移除任意非 owner 成员（每行「移除」按钮仅 owner 可见）；
 *  - 普通成员仅能退出自己（当前用户且非 owner 的行显示「退出项目」）；
 *  - owner 自身不可被移除，也无「退出」入口。
 *
 * DELETE /projects/{id}/members/{userId} → 204 无响应体，故用原生 fetch（契约层
 * api.delete 需解析 JSON 信封，不适用 204）。错误用 InlineError 驻留 + toast 瞬时提示。
 */

/** ISO → 「2026年9月10日」（加入日期，只需日期精度）。 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

type PendingAction =
  | { kind: "remove"; member: MemberDTO }
  | { kind: "exit"; member: MemberDTO };

export type MembersListProps = {
  projectId: string;
  currentUserId: string;
  /** 当前用户是否为项目 owner（决定「移除」按钮可见性；服务端仍权威复核）。 */
  isOwner: boolean;
  members: MemberDTO[];
};

export function MembersList({
  projectId,
  currentUserId,
  isOwner,
  members,
}: MembersListProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const membersPath = `/app/projects/${projectId}/members`;

  function goToLogin(): void {
    const redirectPath = loginPathWithReturnTo(membersPath);
    void router.push(redirectPath);
  }

  async function handleConfirm(): Promise<void> {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    const action = pending;
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/members/${action.member.userId}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (response.status === 401) {
        goToLogin();
        return;
      }
      if (!response.ok) {
        setError(await readErrorMessage(response, "操作失败，请稍后重试。"));
        setBusy(false);
        return;
      }

      if (action.kind === "exit") {
        toast({ title: "你已退出该项目", variant: "success" });
        // 已非成员：硬跳转项目列表，离开本项目所有页面。
        void router.push("/app/projects");
        return;
      }

      setPending(null);
      toast({ title: `已移除 ${action.member.name}`, variant: "success" });
      await router.refresh();
    } catch {
      setError("无法连接服务器，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <p className="font-mono text-caption uppercase tracking-[0.18em] text-foreground-muted">
          members · /api/v1/projects/{projectId}/members
        </p>
        <h1 className="mt-1 text-page font-semibold tracking-tight text-foreground">
          项目成员
        </h1>
        <p className="mt-1.5 text-label text-foreground-secondary">
          共 {members.length} 名成员。{isOwner ? "作为所有者，你可以移除非所有者成员。" : "你可以选择退出该项目。"}
        </p>
      </header>

      <InlineError className="mb-4">{error}</InlineError>

      {members.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="暂无成员"
          description="邀请链接被接受后，新成员会出现在这里。"
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-popover">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const isOwnerRow = member.role === "OWNER";
            const canRemove = isOwner && !isOwnerRow;
            const canExit = isSelf && !isOwnerRow;

            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <Avatar name={member.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-label font-medium text-foreground">
                    <span className="truncate">{member.name}</span>
                    {isSelf ? (
                      <span className="shrink-0 text-caption text-foreground-muted">（你）</span>
                    ) : null}
                  </p>
                  <p className="text-caption text-foreground-muted">
                    加入于 {formatDate(member.joinedAt)}
                  </p>
                </div>
                <Badge tone={isOwnerRow ? "brand" : "neutral"} className="shrink-0">
                  {isOwnerRow ? "所有者" : "成员"}
                </Badge>
                <div className="flex shrink-0 items-center gap-2">
                  {canRemove ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-danger hover:bg-danger-soft"
                      onClick={() => {
                        setError(null);
                        setPending({ kind: "remove", member });
                      }}
                    >
                      <UserMinus className="h-4 w-4" aria-hidden="true" />
                      移除
                    </Button>
                  ) : null}
                  {canExit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setError(null);
                        setPending({ kind: "exit", member });
                      }}
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      退出项目
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "exit" ? "退出项目" : "移除成员"}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === "exit"
                ? `退出后你将无法再访问「${pending.member.name}」所在的本项目，需要重新接受邀请才能加入。确定退出吗？`
                : `确定将 ${pending?.member.name ?? "该成员"} 移出项目吗？其在本项目的任务分配将被清空，此操作需要重新邀请才能恢复。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {busy ? <Spinner /> : null}
              <span>
                {busy
                  ? "正在处理…"
                  : pending?.kind === "exit"
                    ? "确认退出"
                    : "确认移除"}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 从错误响应体解析用户可读消息；解析失败回退到给定默认文案。 */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    const parsed = ErrorResponseSchema.safeParse(
      text.length > 0 ? (JSON.parse(text) as unknown) : null,
    );
    return parsed.success ? parsed.data.error.message : fallback;
  } catch {
    return fallback;
  }
}
