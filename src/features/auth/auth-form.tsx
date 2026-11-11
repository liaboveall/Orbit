"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { InlineError } from "@/components/ui/inline-error";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { assessPasswordStrength } from "./validation";

/**
 * 认证表单共用的零件：提交按钮、带标签的字段、文字链接和结果说明。
 *
 * 可访问性：每个字段用 useId 关联标签，错误经 aria-describedby 和 role=alert 宣告；
 * 密码显示切换是真实的按钮；提交中按钮禁用并改变文案，不单靠转圈表达。
 */

/** 正文里的文字链接：品牌色，悬停出现下划线。 */
export const textLink =
  "rounded-[6px] font-medium text-brand-ink underline-offset-4 outline-none hover:underline";

/** 字段下方的错误：输入框已经变红，这里只用一行红字说明，不再加底色。 */
const fieldError = "bg-transparent px-0.5 py-0 text-caption";

const noticeTone = {
  brand: "bg-brand-soft text-brand-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;

/**
 * 结果说明：提交成功、链接失效这类取代表单的状态。图标、标题、说明和后续操作居中排列。
 * 它的标题就是此时的页面标题（h1），外壳里的静态标题会让位（见 AuthShell）。
 */
export function AuthNotice({
  tone = "brand",
  icon,
  title,
  children,
  actions,
}: {
  tone?: keyof typeof noticeTone;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  /** 标题下的操作：主按钮在前，文字链接在后。 */
  actions?: ReactNode;
}) {
  return (
    <div data-auth-notice="" className="text-center">
      <span
        aria-hidden="true"
        className={cn(
          "mx-auto flex h-14 w-14 items-center justify-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.5)] [&>svg]:h-6 [&>svg]:w-6",
          noticeTone[tone],
        )}
      >
        {icon}
      </span>
      <h1 className="mt-4 text-section font-semibold tracking-[-0.012em] text-foreground">{title}</h1>
      {children ? (
        <div className="mt-2 space-y-2 text-label leading-relaxed text-foreground-secondary">{children}</div>
      ) : null}
      {actions ? <div className="mt-6 flex flex-col items-center gap-3 text-label">{actions}</div> : null}
    </div>
  );
}

export type SubmitButtonProps = ComponentProps<typeof Button> & {
  pending?: boolean;
  pendingText?: string;
};

/** 主提交按钮：pending 时禁用并显示 spinner + pendingText。 */
export function SubmitButton({
  pending = false,
  pendingText,
  children,
  disabled,
  className,
  ...props
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      size="lg"
      className={cn("w-full", className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <Spinner /> : null}
      <span>{pending && pendingText ? pendingText : children}</span>
    </Button>
  );
}

export type TextFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
  label: string;
  /** 字段级错误（客户端即时校验或服务端字段错误）。 */
  error?: string | null;
  /** 标签下方的辅助说明。 */
  hint?: ReactNode;
};

/** 带标签 + 错误 + 辅助说明的文本字段。 */
export function TextField({ label, error, hint, className, ...props }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={className}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-caption text-foreground-muted">
          {hint}
        </p>
      ) : null}
      <InlineError id={errorId} className={fieldError}>{error}</InlineError>
    </div>
  );
}

export type PasswordFieldProps = Omit<ComponentProps<typeof Input>, "id" | "type"> & {
  label: string;
  error?: string | null;
  /** 是否显示强度提示（注册/重设用；登录不需要）。 */
  showStrength?: boolean;
  hint?: ReactNode;
};

/** 密码字段：可见性切换 + 可选强度条（12–128 提示）。 */
export function PasswordField({
  label,
  error,
  showStrength = false,
  hint,
  className,
  value,
  ...props
}: PasswordFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const strengthId = `${id}-strength`;

  const text = typeof value === "string" ? value : "";
  const strength = showStrength ? assessPasswordStrength(text) : null;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null, strength ? strengthId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
          aria-label={revealed ? "隐藏密码" : "显示密码"}
          className="-my-1 inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-caption text-foreground-secondary outline-none transition-colors duration-150 ease-standard hover:text-foreground"
        >
          {revealed ? (
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {revealed ? "隐藏" : "显示"}
        </button>
      </div>
      <Input
        id={id}
        type={revealed ? "text" : "password"}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={className}
        {...props}
      />
      {strength ? (
        <div id={strengthId} className="space-y-1">
          <div className="flex gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((seg) => (
              <span
                key={seg}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-200 ease-standard",
                  seg <= strength.score ? strengthToneBar(strength.score) : "bg-surface-sunken",
                )}
              />
            ))}
          </div>
          <p className={cn("text-caption", strength.tone)}>{strength.label}</p>
        </div>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-caption text-foreground-muted">
          {hint}
        </p>
      ) : null}
      <InlineError id={errorId} className={fieldError}>{error}</InlineError>
    </div>
  );
}

/** 强度分段条的颜色。 */
function strengthToneBar(score: number): string {
  if (score <= 1) return "bg-danger";
  if (score === 2) return "bg-warning";
  return "bg-success";
}
