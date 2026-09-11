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
import { Spinner } from "@/features/auth/auth-form";

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

/** ISO → 「2026 年 9 月 17 日 14:03」（浏览器本地时区）。 */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

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
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [clientToken, setClientToken] = useState<string | null>(null);

  // Extract token from hash fragment on mount (#token=<hash>)
  useEffect(() => {
    let active = true;

    function extractFromHash(): string | null {
      if (typeof window === "undefined") return null;
      const hash = window.location.hash.slice(1); // remove '#'
      if (hash.startsWith("token=")) {
        try {
          const decoded = decodeURIComponent(hash.slice(6));
          // Store in sessionStorage for logout/login flow
          sessionStorage.setItem("inviteToken", decoded);
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
      try {
        // First check hash, then sessionStorage (for login redirect scenario)
        let tokenToUse = extractFromHash();
        if (!tokenToUse) {
          tokenToUse = sessionStorage.getItem("inviteToken");
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
          sessionStorage.removeItem("inviteToken");
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
  }, []);

  async function handleAccept(): Promise<void> {
    if (accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const tokenToSubmit = clientToken || sessionStorage.getItem("inviteToken");

      if (!tokenToSubmit) {
        setAcceptError("No token available");
        setAccepting(false);
        return;
      }

      const result = await api.post("/invitations/accept", AcceptedInvitationSchema, { token: tokenToSubmit });
      if (result.ok) {
        // SUCCESS: CLEAR TOKEN from memory immediately after acceptance!
        sessionStorage.removeItem("inviteToken");
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
        sessionStorage.removeItem("inviteToken");
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
      <div className="space-y-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-page font-semibold tracking-tight text-foreground">
          {status.title}
        </h1>
        <p className="text-label leading-relaxed text-foreground-secondary">{status.detail}</p>
        <InlineError>此邀请链接无法使用。如有疑问，请联系项目所有者重新发送邀请。</InlineError>
      </div>
    );
  }

  const { preview } = status;

  return (
    <div className="space-y-5">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <UserPlus className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-page font-semibold tracking-tight text-foreground">
          邀请你加入项目
        </h1>
        <p className="text-section font-semibold text-brand">{preview.projectName}</p>
      </div>

      <dl className="space-y-2 rounded-card border border-line bg-surface-sunken px-4 py-3 text-label">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-foreground-muted">邀请人</dt>
          <dd className="font-medium text-foreground">{preview.ownerName}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-foreground-muted">加入角色</dt>
          <dd className="font-medium text-foreground">成员</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-foreground-muted inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            过期时间
          </dt>
          <dd className="font-medium text-foreground">{formatDateTime(preview.expiresAt)}</dd>
        </div>
      </dl>

      {preview.isArchived ? (
        <InlineError>该项目已归档，处于只读状态，暂不接受新成员加入；请联系项目所有者恢复项目后再试。</InlineError>
      ) : null}

      <InlineError>{acceptError}</InlineError>

      {/* Always show accept button - auth check happens on API endpoint */}
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

      <p className="text-caption leading-relaxed text-foreground-muted">
        接受后你将成为该项目成员，可查看任务与看板。此链接为一次性邀请：一旦被任意一人接受，
        对所有人立即失效。
      </p>
    </div>
  );
}
