"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { InlineError } from "@/components/ui/inline-error";
import { cn } from "@/lib/cn";
import { assessPasswordStrength } from "./validation";

/**
 * 认证表单共享原子（M1 / ORB-005）。
 *
 * 全部走 tokens 与既有 ui 组件（Button/Input/Label/InlineError）。可访问性（docs/02 §6）：
 *  - 每个字段用 useId 生成稳定 id，Label htmlFor 关联，错误经 aria-describedby + role=alert 宣告；
 *  - 密码可见性切换是真实 button（有 aria-label / aria-pressed），键盘可操作；
 *  - 提交中：按钮 disabled + spinner + 文案变化（reduced-motion 下仍有文字态）。
 */

/** 提交按钮内联 spinner（lucide Loader2 旋转；文案同时变化，不单靠动画）。 */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden="true" />
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
      <InlineError id={errorId}>{error}</InlineError>
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
          className="inline-flex items-center gap-1 rounded-control px-1 text-caption text-foreground-muted transition-colors duration-150 ease-standard hover:text-foreground"
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
                  "h-1 flex-1 rounded-full transition-colors duration-150 ease-standard",
                  seg <= strength.score ? strengthToneBar(strength.score) : "bg-line",
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
      <InlineError id={errorId}>{error}</InlineError>
    </div>
  );
}

/** 强度分段条颜色（走语义 token）。 */
function strengthToneBar(score: number): string {
  if (score <= 1) return "bg-danger";
  if (score === 2) return "bg-warning";
  return "bg-success";
}
