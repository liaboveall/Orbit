import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Button / IconButton（ORB-002 基础组件）。
 *
 * 样式全部消费 tokens（不硬编码颜色/尺寸）：高度 md=40、lg=44（触控目标），
 * 圆角 rounded-control(8)，焦点环由 tokens.css 的 :focus-visible 全局规则提供
 * （2px brand + 2px offset）。React 19 下 ref 作为普通 prop 透传，无需 forwardRef。
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-foreground-invert hover:bg-brand-hover active:bg-brand-hover",
  secondary:
    "border border-line-strong bg-surface text-foreground hover:bg-surface-sunken",
  ghost:
    "bg-transparent text-foreground-secondary hover:bg-surface-sunken hover:text-foreground",
  danger: "bg-danger text-foreground-invert hover:bg-danger/90",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-label",
  md: "h-10 gap-2 px-4 text-label",
  lg: "h-11 gap-2 px-5 text-body",
};

/** 生成按钮样式类，供 Button 与需要按钮外观的其他元素复用。 */
export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex select-none items-center justify-center rounded-control font-medium",
    "transition-[background-color,color,opacity] duration-150 ease-standard",
    "disabled:pointer-events-none disabled:opacity-50",
    variantClass[variant],
    sizeClass[size],
    className,
  );
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}

const iconSizeClass: Record<ButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-11 w-11",
};

export type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 可访问名称：IconButton 无可见文本，必须提供（映射到 aria-label）。 */
  label: string;
  children: React.ReactNode;
};

/**
 * 仅图标按钮。强制 `label` 作为 aria-label，保证屏幕阅读器有可访问名称
 * （docs/02 §6：不另造不可访问的基础组件）。触控端 size=lg 达 44px。
 */
export function IconButton({
  variant = "ghost",
  size = "md",
  label,
  className,
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-control",
        "transition-[background-color,color,opacity] duration-150 ease-standard",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClass[variant],
        iconSizeClass[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
