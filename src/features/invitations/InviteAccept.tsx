"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, ShieldAlert, UserPlus } from "lucide-react";
import {
  AcceptedInvitationSchema,
  ApiClientError,
  InvitePreviewSchema,
  createApiClient,
  type InvitePreviewDTO,
} from "@/contracts";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatEventDateTime, useUserTimezone } from "@/lib/user-timezone";
import { AuthNotice } from "@/features/auth/auth-form";
import { forgetInviteToken, recallInviteToken, rememberInviteToken } from "./pending-invite";

/**
 * 邀请预览与接受 (M4 / ORB-013，公开页 /invite#token=<hash>).
 *
 * 安全修复 (R02): 
 * - Token 从哈希片段提取，不在 URL bar 显示 → 避免日志/referer 泄露
 * - POST /invitations/accept 时 token 在请求体中传输
 * - 接受后立即清除 sessionStorage 中的 token
 *
 * Client Component:
 *  1. Mount extracts token from window.location.hash (#token=...)  
 *  2. Stores in sessionStorage for login redirect scenario
 *  3. POST /invitations/preview(body {token}) for preview
 *  4. POST /invitations/accept(body {token}) to accept → redirect to board
 *  5. Clears session storage immediately after acceptance
 *
 * No ToastProvider (root layout), so errors use InlineError only.
 * Boundary (features layer): No imports of @/server / @/generated.
 */

const api = createApiClient();

type Status =
  | { kind: "loading" }
  | { kind: "valid"; preview: InvitePreviewDTO }
  | { kind: "error"; title: string; detail: string };

/** 错误码 → 用户可读标题（docs/05 §3、previewInvitation 抛出的领域错误码）。 */
function describePreviewError(code: string, message: string): { title: string; detail: string } {
  switch (code) {
    case "INVITATION_EXPIRED":
      return { title: "邀请已过期", detail: message };
    case "INVITATION_REVOKED":
      return { title: "邀请已被撤销", detail: message };
    case "INVITATION_USED":
      return { title: "邀请已被使用", detail: message };
    case "NOT_FOUND":
      return { title: "邀请链接无效", detail: message };
    default:
      return { title: "无法加载邀请信息", detail: message };
  }
}

// F23 修复：预览过期时间改用账户时区（登录前无会话 → useUserTimezone 兜底设备时区）。
export type InviteAcceptProps = {
  /** Token from server-side (always null for fragment protocol), client extracts from hash. */
  token: string | null;
  /** Not used in fragment mode - handled by client. */
  isLoggedIn: boolean;
  /** Return path for login redirect. */
  returnPath: string;
};

/**
 * Client component that handles hash fragment token extraction.
 * Security (R02): Token never appears in URL bar → no logs/referer leaks.
 */

export function InviteAccept({ token: _serverToken }: InviteAcceptProps) {
  const tz = useUserTimezone(); // F23：登录前无会话，兜底设备时区。
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [clientToken, setClientToken] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  // Extract token from hash fragment on mount (#token=<hash>)
  useEffect(() => {
    let active = true;

    function extractFromHash(): string | null {
      if (typeof window === "undefined") return null;
      const hash = window.location.hash.slice(1); // remove '#'
      if (hash.startsWith("token=")) {
        try {
          const decoded = decodeURIComponent(hash.slice(6));
          // 标签页内暂存（最多 30 分钟），支持登录/换账号后回到 /invite 接受
          rememberInviteToken(decoded);
          // Clear hash from URL bar for privacy
          history.replaceState(null, "", window.location.pathname);
          return decoded;
        } catch (err) {
          console.warn("Failed to decode token from hash:", err);
          return null;
        }
      }
      return null;
    }

    async function load(): Promise<void> {
      setStatus({ kind: "loading" });
      try {
        // First check hash, then sessionStorage (for login redirect scenario)
        let tokenToUse = extractFromHash();
        if (!tokenToUse) {
          tokenToUse = recallInviteToken();
        }

        if (!tokenToUse || tokenToUse.trim().length === 0) {
          if (!active) return;
          setStatus({
            kind: "error",
            title: "邀请链接无效",
            detail: "该链接缺少邀请令牌。请使用完整的邀请链接重试，或联系项目所有者重新发送邀请。",
          });
          return;
        }

        setClientToken(tokenToUse);

        const result = await api.post("/invitations/preview", InvitePreviewSchema, { token: tokenToUse });
        if (!active) return;
        if (result.ok) {
          setStatus({ kind: "valid", preview: result.data });
        } else {
          // A13 修复：预览阶段已判定为终态失效（过期/撤销/已用/不存在），token 不再有
          // 任何用途，清除 sessionStorage 里的临时副本，不留下无限期滞留的令牌。
          if (["NOT_FOUND", "INVITATION_EXPIRED", "INVITATION_REVOKED", "INVITATION_USED"].includes(result.error.code)) {
            forgetInviteToken();
            setClientToken(null);
          }
          setStatus({ kind: "error", ...describePreviewError(result.error.code, result.error.message) });
        }
      } catch (err) {
        if (!active) return;
        setStatus({
          kind: "error",
          title: "无法连接服务器",
          detail:
            err instanceof ApiClientError
              ? "请检查网络后刷新页面重试。"
              : "加载邀请信息失败，请稍后重试。",
        });
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [retry]);

  async function handleAccept(): Promise<void> {
    if (accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const tokenToSubmit = clientToken || recallInviteToken();

      if (!tokenToSubmit) {
        setAcceptError("邀请链接无效或已过期，请向项目所有者重新获取。");
        setAccepting(false);
        return;
      }

      const result = await api.post("/invitations/accept", AcceptedInvitationSchema, { token: tokenToSubmit });
      if (result.ok) {
        // SUCCESS: CLEAR TOKEN from memory immediately after acceptance!
        forgetInviteToken();
        setClientToken(null);
        
        // Hard redirect to project board
        void router.push(`/app/projects/${result.data.projectId}/board`);
        return;
      }
      if (result.status === 401) {
        // Redirect to login with returnTo=/invite (NO TOKEN in query string!)
        void router.push(`/auth/login?returnTo=/invite`);
        return;
      }
      // A13 修复：已失效/已撤销/已使用（410/409）是终态错误，token 不再有任何用途——
      // 清除 sessionStorage 中的临时 token，避免它无限期滞留（此前只有成功路径才清除）。
      // 网络暂时失败（ApiClientError，见 catch 分支）不属于此列：那种情况 token 仍
      // 可能有效，必须保留可恢复能力，让用户刷新/重试而不必重新打开邀请链接。
      if (
        result.status === 410 ||
        (result.status === 409 && result.error.code === "INVITATION_USED")
      ) {
        forgetInviteToken();
        setClientToken(null);
      }
      setAcceptError(result.error.message);
      setAccepting(false);
    } catch (err) {
      setAcceptError(
        err instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "接受邀请失败，请稍后重试。",
      );
      setAccepting(false);
    }
  }

  if (status.kind === "loading") {
    return (
      <SkeletonBlock label="正在加载邀请信息">
        <div className="space-y-4">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-11 w-full" />
        </div>
      </SkeletonBlock>
    );
  }

  if (status.kind === "error") {
    return (
      <AuthNotice
        tone="danger"
        icon={<ShieldAlert />}
        title={status.title}
        actions={clientToken ? <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>重新加载邀请</Button> : null}
      >
        <p>{status.detail}</p>
        <p role="alert" className="text-caption text-foreground-muted">
          此邀请链接无法使用。如有疑问，请联系项目所有者重新发送邀请。
        </p>
      </AuthNotice>
    );
  }

  const { preview } = status;

  return (
    <div className="space-y-5">
      <AuthNotice icon={<UserPlus />} title="邀请你加入项目">
        <p className="text-title font-semibold text-foreground [overflow-wrap:anywhere]">{preview.projectName}</p>
      </AuthNotice>

      <dl className="divide-y divide-line rounded-tile bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--color-line)]">
        <div className="flex min-h-11 items-center justify-between gap-3 px-3.5">
          <dt className="text-foreground-secondary">邀请人</dt>
          <dd className="min-w-0 truncate font-medium text-foreground">{preview.ownerName}</dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 px-3.5">
          <dt className="text-foreground-secondary">加入角色</dt>
          <dd className="font-medium text-foreground">成员</dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 px-3.5">
          <dt className="inline-flex items-center gap-1.5 text-foreground-secondary">
            <CalendarClock className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
            过期时间
          </dt>
          <dd className="font-medium tabular-nums text-foreground">{formatEventDateTime(preview.expiresAt, tz)}</dd>
        </div>
      </dl>

      {preview.isArchived ? (
        <InlineError>该项目已归档，处于只读状态，暂不接受新成员加入；请联系项目所有者恢复项目后再试。</InlineError>
      ) : null}

      <InlineError>{acceptError}</InlineError>

      {/* 始终显示接受按钮：是否登录由接口判断，未登录时跳转登录后回到本页。 */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={accepting || preview.isArchived}
        aria-busy={accepting || undefined}
        onClick={() => {
          void handleAccept();
        }}
      >
        {accepting ? <Spinner /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
        <span>{accepting ? "正在接受…" : "接受邀请"}</span>
      </Button>

      <p className="text-center text-caption leading-relaxed text-foreground-muted">
        接受后你将成为项目成员，可以查看任务和看板。链接只能使用一次，被任何人接受后立即失效。
      </p>
    </div>
  );
}
