"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Check, Copy, Link2, Plus, Trash2 } from "lucide-react";
import {
  ApiClientError,
  CreatedInvitationSchema,
  ErrorResponseSchema,
  INVITATION_STATE,
  createApiClient,
  type InvitationDTO,
  type InvitationState,
} from "@/contracts";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
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
 * 邀请管理列表（M4 / ORB-013，`/app/projects/[id]/invitations`）。
 *
 * 数据流沿用 projects/tasks 范式：首屏 InvitationDTO[] 由 Server Component 直调
 * 领域服务 listInvitations 取得后经 props 传入；创建/撤销成功后 `router.refresh()`
 * 让 Server Component 重读列表，props 是唯一数据真源（不用 useState 镜像整份列表）。
 *
 * 契约要点（docs/05 §5、src/contracts/dto.ts）：
 *  - POST /projects/{id}/invitations **无请求体**，需 Idempotency-Key；201 首次返回
 *    CreatedInvitation（含明文 token + invitePath），幂等重放 200 → token/invitePath 为 null；
 *  - 明文 token 仅创建时返回一次，故「复制链接」只在创建成功后的一次性面板内可用；
 *  - DELETE /projects/{id}/invitations/{invitationId} → 204 无响应体（owner-only）；
 *  - InvitationDTO.state 由服务端计算（ACTIVE/EXPIRED/REVOKED/USED），前端直接消费。
 *
 * 边界（features 层）：不导入 @/server / @/generated；错误用 InlineError 驻留 + toast 瞬时提示。
 */

const api = createApiClient();

/** 状态 → 中文标签。 */
const STATE_LABEL: Record<InvitationState, string> = {
  ACTIVE: "有效",
  EXPIRED: "已过期",
  REVOKED: "已撤销",
  USED: "已使用",
};

/** 状态 → Badge 语义色（不单靠颜色，均配文案）。 */
const STATE_TONE: Record<InvitationState, BadgeTone> = {
  ACTIVE: "success",
  EXPIRED: "warning",
  REVOKED: "danger",
  USED: "brand",
};

/** 过滤器选项：全部 + 四种状态。 */
const FILTERS = ["ALL", ...INVITATION_STATE] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  ALL: "全部",
  ACTIVE: "有效",
  EXPIRED: "已过期",
  REVOKED: "已撤销",
  USED: "已使用",
};

/** ISO 日期时间 → 「2026年9月10日 14:03」（浏览器本地时区）。 */
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

export type InvitationsListProps = {
  projectId: string;
  /** 当前用户是否为项目 owner：仅 owner 可创建/撤销邀请（服务端仍权威复核）。 */
  userIsOwner: boolean;
  initialInvitations: InvitationDTO[];
};

export function InvitationsList({
  projectId,
  userIsOwner,
  initialInvitations,
}: InvitationsListProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // 创建成功后一次性展示的邀请链接（明文 token 仅此一次可得）。
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 待撤销的邀请（非 null 时打开撤销确认对话框）。
  const [revoking, setRevoking] = useState<InvitationDTO | null>(null);
  const [revokingBusy, setRevokingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 创建 POST 的幂等键：挂载时生成，业务错误后换新键（对齐 project-create-form）。
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const invitations = initialInvitations;
  const visible =
    filter === "ALL" ? invitations : invitations.filter((inv) => inv.state === filter);

  /** 401（会话失效）→ 硬跳转登录页，让 proxy/服务端重估认证态。 */
  const goToLogin = useCallback(() => {
    window.location.assign(loginPathWithReturnTo(`/app/projects/${projectId}/invitations`));
  }, [projectId]);

  async function handleCreate(): Promise<void> {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      // 无请求体：过期时间由服务端固定（默认 7 天）；携带幂等键防重复创建。
      const result = await api.post(
        `/projects/${projectId}/invitations`,
        CreatedInvitationSchema,
        undefined,
        { idempotencyKey },
      );
      if (result.ok) {
        setCreateOpen(false);
        // 首次创建返回明文 token + invitePath（哈希片段格式 `/invite#token=<token>`）；
        // 幂等重放时两者同为 null。
        // 以服务端 invitePath 为唯一真源，不在前端另行拼接路径：两处各自构造曾导致
        // 服务端返回 `/invite/<token>` 死链而前端用片段格式，二者长期不一致（ISS-04）。
        if (result.data.invitePath) {
          setCreatedLink(`${window.location.origin}${result.data.invitePath}`);
          setCopied(false);
        } else {
          setCreatedLink(null);
        }
        toast({ title: "邀请已创建", variant: "success" });
        setIdempotencyKey(crypto.randomUUID());
        await router.refresh();
        return;
      }

      // 业务错误：请求已被拒绝、未落库，换新幂等键避免后续撞 IDEMPOTENCY_CONFLICT。
      setIdempotencyKey(crypto.randomUUID());
      if (result.status === 401) {
        goToLogin();
        return;
      }
      setError(result.error.message);
    } catch (err) {
      // 传输层歧义失败：保留原幂等键（请求可能已成功落库，换键会创建重复邀请）。
      setError(
        err instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "创建邀请失败，请稍后重试。",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast({ title: "链接已复制到剪贴板", variant: "success" });
    } catch {
      toast({ title: "复制失败，请手动选中链接复制", variant: "danger" });
    }
  }

  async function handleRevoke(): Promise<void> {
    if (!revoking || revokingBusy) return;
    setRevokingBusy(true);
    setError(null);
    const target = revoking;
    try {
      // DELETE → 204 无响应体，契约层 api.delete 需要 JSON 信封，故此处用原生 fetch。
      const response = await fetch(
        `/api/v1/projects/${projectId}/invitations/${target.id}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (response.status === 401) {
        goToLogin();
        return;
      }
      if (!response.ok) {
        setError(await readErrorMessage(response, "撤销邀请失败，请稍后重试。"));
        return;
      }
      setRevoking(null);
      toast({ title: "邀请已撤销", variant: "success" });
      await router.refresh();
    } catch {
      setError("无法连接服务器，请检查网络后重试。");
    } finally {
      setRevokingBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <p className="font-mono text-caption uppercase tracking-[0.18em] text-foreground-muted">
          invitations · /api/v1/projects/{projectId}/invitations
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-page font-semibold tracking-tight text-foreground">
              邀请管理
            </h1>
            <p className="mt-1.5 text-label text-foreground-secondary">
              创建邀请链接分享给同事，他们接受后即成为项目成员。链接有效期 7 天，明文令牌仅在创建时显示一次。
            </p>
          </div>
          {userIsOwner ? (
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              创建邀请
            </Button>
          ) : null}
        </div>
      </header>

      <InlineError className="mb-4">{error}</InlineError>

      {/* 一次性链接面板：明文 token 仅创建后可得，故只在此处提供复制。 */}
      {createdLink ? (
        <section
          aria-label="新创建的邀请链接"
          className="mb-6 space-y-3 rounded-card border border-brand/30 bg-brand-soft px-4 py-4"
        >
          <p className="text-label font-medium text-foreground">
            邀请链接已生成，请立即复制分享（关闭后无法再次查看明文令牌）：
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-control border border-line bg-surface px-3 py-2 font-mono text-caption text-foreground">
              {createdLink}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void handleCopy(createdLink);
              }}
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? "已复制" : "复制链接"}
            </Button>
          </div>
        </section>
      ) : null}

      {/* 状态过滤器 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-caption font-medium text-foreground-muted">状态</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="按状态筛选邀请">
          {FILTERS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={filter === option ? "primary" : "ghost"}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {FILTER_LABEL[option]}
            </Button>
          ))}
        </div>
        <span className="ml-auto text-caption text-foreground-muted">
          共 {visible.length} 个邀请
        </span>
      </div>

      {/* 邀请列表 */}
      {visible.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title={filter === "ALL" ? "还没有邀请" : `没有「${FILTER_LABEL[filter]}」的邀请`}
          description={
            userIsOwner
              ? "创建邀请链接，分享给同事即可让他们加入项目。"
              : "只有项目所有者可以创建邀请链接。"
          }
          action={
            userIsOwner && filter === "ALL" ? (
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  setError(null);
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                创建第一个邀请
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-popover">
          {visible.map((invitation) => {
            const canRevoke = userIsOwner && invitation.state === "ACTIVE";
            return (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <Badge tone={STATE_TONE[invitation.state]} className="shrink-0">
                  {STATE_LABEL[invitation.state]}
                </Badge>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-label text-foreground-secondary">
                    创建于 {formatDateTime(invitation.createdAt)}
                    {invitation.state !== "EXPIRED" ? (
                      <> · 过期于 {formatDateTime(invitation.expiresAt)}</>
                    ) : null}
                  </p>
                  {invitation.state === "USED" && invitation.acceptedAt ? (
                    <p className="text-caption text-foreground-muted">
                      已于 {formatDateTime(invitation.acceptedAt)} 被接受
                    </p>
                  ) : null}
                  {invitation.state === "REVOKED" && invitation.revokedAt ? (
                    <p className="text-caption text-foreground-muted">
                      已于 {formatDateTime(invitation.revokedAt)} 被撤销
                    </p>
                  ) : null}
                </div>
                {canRevoke ? (
                  <IconButton
                    label="撤销邀请"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-danger hover:bg-danger-soft"
                    onClick={() => {
                      setError(null);
                      setRevoking(invitation);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* 创建邀请对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建邀请链接</DialogTitle>
            <DialogDescription>
              邀请链接有效期为 7 天。创建成功后会显示一次完整链接，请立即复制分享给同事；
              明文令牌不会再次显示。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={creating}
              aria-busy={creating || undefined}
              onClick={() => {
                void handleCreate();
              }}
            >
              {creating ? <Spinner /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              <span>{creating ? "正在创建…" : "创建邀请"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 撤销确认对话框 */}
      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤销邀请</DialogTitle>
            <DialogDescription>
              撤销后该邀请链接立即失效，被邀请人将无法再用它加入项目。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={revokingBusy}
              onClick={() => setRevoking(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={revokingBusy}
              aria-busy={revokingBusy || undefined}
              onClick={() => {
                void handleRevoke();
              }}
            >
              {revokingBusy ? <Spinner /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              <span>{revokingBusy ? "正在撤销…" : "确认撤销"}</span>
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
