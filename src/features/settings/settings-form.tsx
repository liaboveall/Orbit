"use client";

import { Mail, RotateCcw, Save, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/features/tasks/unsaved-changes";
import {
  ApiClientError,
  UserSchema,
  createApiClient,
  type UpdateMeDTO,
  type UserDTO,
} from "@/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";
import { TimezonePicker } from "./timezone-picker";
import { ZonePreview } from "./zone-preview";
import { buildTimezoneOptions, isKnownTimezone } from "./timezones";

/**
 * 个人设置表单（M1 / ORB-006，`/app/settings`）。
 *
 * 交互设计（docs/02 §5「姓名与时区」）：编辑式控制台 —— 左侧两行编号字段（01 姓名 /
 * 02 时区），右侧常驻「当地此刻」实时预览 + 账户信息。改任一项即进入 dirty 态，
 * 出现「放弃更改」；未 dirty 时保存按钮禁用（避免无意义写库与限流消耗）。
 *
 * 数据流：
 *  - 服务端组件（page.tsx）已用会话 + 直接查库取得权威 UserDTO 作为初值；
 *  - 提交走契约层 `createApiClient().patch("/me", UserSchema, body)` —— 复用
 *    统一信封解析与响应 schema 校验，不裸写 fetch（AGENTS.md：契约层前后端共享）；
 *  - 只把**变更过**的字段放进请求体（PATCH 语义；契约 minProperties:1 要求至少一项）；
 *  - 成功后：更新本地基线 → toast → `router.refresh()` 让 AppShell（服务端渲染的
 *    顶栏时区、侧栏姓名）与本页拿到同一份新数据，无需引入客户端缓存库。
 *
 * 错误处理：400 的 `fieldErrors` 映射到对应字段的 InlineError（role=alert 驻留，
 * 不只靠 toast）；401 表示会话已失效 → 展示「重新登录」面板；其余用错误信封 message。
 *
 * 边界：features 层，不导入 @/server / @/generated；时区权威校验仍在服务端。
 */

const NAME_MAX = 40;

/** 与 /api/v1/me 通信的客户端（同源 cookie，默认 credentials:"same-origin"）。 */
const api = createApiClient();

type FieldErrors = { name?: string; timezone?: string };

/** 拼接 aria-describedby 的多个 id（过滤空值，避免 cn 这类样式工具被误用为 id 拼接）。 */
function joinIds(...ids: Array<string | null | undefined>): string | undefined {
  const present = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  return present.length > 0 ? present.join(" ") : undefined;
}

/**
 * B6 修复：个人设置草稿保护（dirty=姓名/时区有未保存修改；pending=保存在途）。
 */
export function SettingsForm(props: { user: UserDTO }) {
  return (
    <UnsavedChangesProvider>
      <SettingsFormContent {...props} />
    </UnsavedChangesProvider>
  );
}

function SettingsFormContent({ user }: { user: UserDTO }) {
  const router = useRouter();
  const composing = useRef(false);
  const { toast } = useToast();
  const nameId = useId();
  const timezoneId = useId();
  const nameHintId = `${nameId}-hint`;
  const timezoneHintId = `${timezoneId}-hint`;

  /** 表单草稿（用户正在编辑的值）。 */
  const [draft, setDraft] = useState({ name: user.name, timezone: user.timezone });
  /**
   * 已持久化基线（dirty 判定用）。
   *
   * 初值取服务端 props，之后**只在保存成功的事件处理里**更新，不用 effect 同步 props
   * （那会造成级联渲染）：`user` props 的唯一变化源就是本页保存后的 `router.refresh()`，
   * 而那时基线已由响应数据设为同一值，不存在漂移；从其他页返回/重新进入设置页是
   * 全新挂载，初值自然就是最新的。 */
  const [saved, setSaved] = useState({ name: user.name, timezone: user.timezone });

  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // 完整 IANA 列表 + GMT 偏移在挂载时算一次（400+ 项构造 Intl 对象有成本）。
  // 依赖已保存的时区：保证即使账户存有 ICU 不再列出的历史标识，它也一定在列表内。
  const timezoneOptions = useMemo(() => buildTimezoneOptions(saved.timezone), [saved.timezone]);

  const trimmedName = draft.name.trim();
  const nameDirty = trimmedName !== saved.name;
  const timezoneDirty = draft.timezone !== saved.timezone;
  const dirty = nameDirty || timezoneDirty;
  useUnsavedChanges(dirty, pending);

  function handleReset(): void {
    setDraft({ name: saved.name, timezone: saved.timezone });
    setFieldErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (composing.current) return;
    if (pending || !dirty) return;

    // 客户端预校验（服务端仍是权威）：即时反馈，省一次往返。
    const nextErrors: FieldErrors = {};
    if (nameDirty) {
      if (trimmedName.length < 1) nextErrors.name = "姓名不能为空。";
      else if (trimmedName.length > NAME_MAX) {
        nextErrors.name = `姓名不能超过 ${NAME_MAX} 个字符。`;
      }
    }
    if (timezoneDirty && !isKnownTimezone(draft.timezone)) {
      nextErrors.timezone = "时区无效，须为 IANA 标识（例如 Asia/Shanghai）。";
    }
    setFieldErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    // 只提交变更字段（PATCH 部分更新语义）。
    const body: UpdateMeDTO = {};
    if (nameDirty) body.name = trimmedName;
    if (timezoneDirty) body.timezone = draft.timezone;

    setPending(true);
    try {
      const result = await api.patch("/me", UserSchema, body);
      if (result.ok) {
        setSaved({ name: result.data.name, timezone: result.data.timezone });
        setDraft({ name: result.data.name, timezone: result.data.timezone });
        setFieldErrors({});
        setSessionExpired(false);
        toast({
          title: "设置已保存",
          description: `姓名「${result.data.name}」 · 时区 ${result.data.timezone}`,
          variant: "success",
        });
        // 让服务端组件（本页 + AppShell 顶栏/侧栏）重新读取最新账户数据。
        router.refresh();
        return;
      }

      if (result.status === 401) {
        setSessionExpired(true);
        return;
      }
      const errors = result.error.fieldErrors;
      setFieldErrors({
        name: firstOf(errors?.name),
        timezone: firstOf(errors?.timezone),
      });
      setFormError(result.error.message);
    } catch (error) {
      // 传输失败或响应不符合统一信封：ApiClientError（不吞错误，给出可操作提示）。
      if (error instanceof ApiClientError) {
        // Check if it's a network error from failed fetch
        const errorMessage = String(error).toLowerCase();
        if (errorMessage.includes("failed to fetch") || errorMessage.includes("network")) {
          setFormError("网络错误，请检查您的网络连接后重试");
        } else {
          setFormError("无法连接服务器，请检查网络后重试。");
        }
      } else {
        setFormError("保存失败，请稍后重试。");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      {/* ── 左列：编辑区 ─────────────────────────────────────────────── */}
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        noValidate
        className="surface-card overflow-hidden rounded-card"
      >
        <header className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="text-section font-semibold tracking-[-0.015em] text-foreground">账户偏好</h2>
          <span
            className={cn("shrink-0 text-caption", dirty ? "text-brand-ink" : "text-foreground-muted")}
            aria-live="polite"
          >
            {pending ? "保存中…" : dirty ? "未保存" : "已保存"}
          </span>
        </header>

        {/* 01 姓名 */}
        <FieldRow title="姓名">
          <div className="space-y-1.5">
            <Label htmlFor={nameId} className="sr-only">
              姓名
            </Label>
            <div className="relative">
              <Input
                id={nameId}
                name="name"
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
                }}
                type="text"
                autoComplete="name"
                maxLength={NAME_MAX}
                placeholder="你在项目中显示的名字"
                value={draft.name}
                disabled={pending}
                aria-invalid={fieldErrors.name ? true : undefined}
                aria-describedby={joinIds(
                  nameHintId,
                  fieldErrors.name ? `${nameId}-error` : null,
                )}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, name: event.target.value }));
                  if (fieldErrors.name) {
                    setFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }
                }}
                className="pr-20"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption tabular-nums",
                  trimmedName.length > NAME_MAX
                    ? "text-danger"
                    : "text-foreground-muted",
                )}
              >
                {trimmedName.length}/{NAME_MAX}
              </span>
            </div>
            <p id={nameHintId} className="text-caption text-foreground-muted">
              1—40 个字符。显示在任务分配、评论与项目成员列表中。
            </p>
            <InlineError id={`${nameId}-error`}>{fieldErrors.name}</InlineError>
          </div>
        </FieldRow>

        {/* 02 时区 */}
        <FieldRow title="时区">
          <div className="space-y-1.5">
            <Label htmlFor={timezoneId} className="sr-only">
              时区
            </Label>
            <TimezonePicker
              id={timezoneId}
              value={draft.timezone}
              options={timezoneOptions}
              disabled={pending}
              invalid={Boolean(fieldErrors.timezone)}
              describedBy={joinIds(
                timezoneHintId,
                fieldErrors.timezone ? `${timezoneId}-error` : null,
              )}
              onChange={(timezone) => {
                setDraft((prev) => ({ ...prev, timezone }));
                if (fieldErrors.timezone) {
                  setFieldErrors((prev) => ({ ...prev, timezone: undefined }));
                }
              }}
            />
            <p id={timezoneHintId} className="text-caption text-foreground-muted">
              影响「逾期 / 今天到期 / 未来 7 天」的日期边界。
            </p>
            <InlineError id={`${timezoneId}-error`}>{fieldErrors.timezone}</InlineError>
          </div>
        </FieldRow>

        {/* 操作条 */}
        <footer className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-2">
          <Button
            type="submit"
            disabled={!dirty || pending}
            aria-busy={pending || undefined}
          >
            {pending ? <Spinner /> : <Save className="h-4 w-4" aria-hidden="true" />}
            <span>{pending ? "正在保存…" : "保存更改"}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || pending}
            onClick={handleReset}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            放弃更改
          </Button>
        </footer>
      </form>

      {/* ── 右列：实时预览 + 账户信息（桌面 sticky，移动端顺延到下方）────── */}
      <div className="space-y-3 lg:sticky lg:top-5">
        <ZonePreview timezone={draft.timezone} />
        <AccountCard user={user} />
      </div>

      {/* 全局错误 / 会话失效：跨列放在网格末尾，两种视口下都在表单之后可读 */}
      <div className="lg:col-span-2 lg:-mt-2">
        {sessionExpired ? (
          <div className="flex flex-wrap items-center gap-3 rounded-tile bg-warning-soft px-4 py-3">
            <p className="min-w-0 flex-1 text-label text-warning">
              会话已失效（可能在其他标签页退出）。更改尚未保存，请重新登录后再试。
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                // 硬跳转：让服务端/proxy 重新评估未认证态（同 UserMenu 退出逻辑）。
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign("/auth/login?returnTo=%2Fapp%2Fsettings");
              }}
            >
              前往登录
            </Button>
          </div>
        ) : null}
        <InlineError className="mt-4">{formError}</InlineError>
      </div>
    </div>
  );
}

/** 取字段错误数组的第一条（信封 fieldErrors 是 string[]）。 */
function firstOf(values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  return values[0];
}

/** 表单的一行：左侧字段名，右侧控件，窄屏上下排列。 */
function FieldRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="grid gap-2 md:grid-cols-[96px_minmax(0,1fr)] md:gap-4">
        <p className="text-label font-medium text-foreground md:pt-2.5">{title}</p>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

/**
 * 账户信息卡：邮箱（V1 不可修改，docs/01 §3）、邮箱验证状态、账户 ID。
 * 只读展示，明确「哪些不能在这里改」，避免用户找不到入口而困惑。
 */
function AccountCard({ user }: { user: UserDTO }) {
  return (
    <section
      aria-label="账户信息"
      className="surface-card overflow-hidden rounded-card"
    >
      <header className="px-4 pt-3.5 text-label font-semibold text-foreground">账户信息</header>
      <dl>
        <Row term="邮箱" icon={<Mail className="h-3.5 w-3.5" aria-hidden="true" />}>
          <dd className="min-w-0 flex-1 truncate text-label text-foreground" title={user.email}>
            {user.email}
          </dd>
          <dd className="shrink-0">
            {user.emailVerified ? (
              <Badge tone="success" icon={<ShieldCheck className="h-3 w-3" />}>
                已验证
              </Badge>
            ) : (
              <Badge tone="warning" icon={<ShieldQuestion className="h-3 w-3" />}>
                未验证
              </Badge>
            )}
          </dd>
        </Row>
      </dl>
      <p className="px-4 pb-3.5 text-caption text-foreground-muted">
        暂不支持在此修改邮箱或删除账户。
      </p>
    </section>
  );
}

/** 账户信息卡的一行（dt + 若干 dd）。 */
function Row({
  term,
  icon,
  children,
}: {
  term: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <dt className="flex w-16 shrink-0 items-center gap-1.5 text-caption text-foreground-muted">
        {icon}
        {term}
      </dt>
      {children}
    </div>
  );
}
