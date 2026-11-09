import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Button / IconButton。胶囊形，按下时轻微回弹；高度 sm=32、md=40、lg=44。
 * 焦点环由 tokens.css 的全局 :focus-visible 规则提供。
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "btn-tint bg-brand text-foreground-invert hover:bg-brand-hover active:bg-brand-hover",
  secondary: "glass-chip text-foreground",
  ghost:
    "bg-transparent text-foreground-secondary hover:bg-surface-sunken hover:text-foreground",
  danger: "btn-tint bg-danger-fill text-foreground-invert hover:brightness-95",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3.5 text-label",
  md: "h-10 gap-2 px-[18px] text-label",
  lg: "h-11 gap-2 px-6 text-body",
};

const motionClass =
  "transition-[background-color,color,opacity,transform,filter] duration-200 ease-standard " +
  "active:scale-[0.965] disabled:pointer-events-none disabled:opacity-45";

/** 生成按钮样式类，供 Button 与需要按钮外观的 Link 复用。 */
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
    "inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium",
    motionClass,
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
  // 手机触控目标不小于 44px，sm 以上恢复紧凑尺寸。
  sm: "h-11 w-11 sm:h-8 sm:w-8",
  md: "h-11 w-11 sm:h-10 sm:w-10",
  lg: "h-11 w-11",
};

export type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 可访问名称：IconButton 没有可见文本，必须提供。 */
  label: string;
  children: React.ReactNode;
};

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
        "inline-flex shrink-0 select-none items-center justify-center rounded-full",
        motionClass,
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
