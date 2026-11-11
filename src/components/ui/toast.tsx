"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Toast（基于 Radix）与轻量的 Provider / useToast。
 *
 * Toast 只用于瞬时确认，不能是唯一的错误反馈：错误同时由 InlineError 驻留显示。
 * Radix 管理 aria-live 宣告和自动消失，不抢焦点。
 */

export type ToastVariant = "info" | "success" | "danger";

type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastItem = Required<Pick<ToastInput, "title" | "variant">> & {
  id: number;
  description?: string;
  duration: number;
};

type ToastContextValue = {
  toast: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const variantIcon: Record<ToastVariant, ReactNode> = {
  info: <Info className="h-[18px] w-[18px] text-brand-ink" aria-hidden="true" />,
  success: <CircleCheck className="h-[18px] w-[18px] text-success" aria-hidden="true" />,
  danger: <CircleAlert className="h-[18px] w-[18px] text-danger" aria-hidden="true" />,
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    counter += 1;
    const item: ToastItem = {
      id: counter,
      title: input.title,
      description: input.description,
      variant: input.variant ?? "info",
      duration: input.duration ?? 4000,
    };
    setToasts((prev) => [...prev, item]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            data-lens=""
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            className="glass-menu relative flex w-[min(92vw,360px)] animate-pop-in items-start gap-3 rounded-card py-3 pl-4 pr-10 text-foreground"
          >
            <span className="mt-0.5 shrink-0">{variantIcon[t.variant]}</span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <ToastPrimitive.Title className="text-label font-semibold">{t.title}</ToastPrimitive.Title>
              {t.description ? (
                <ToastPrimitive.Description className="text-caption text-foreground-secondary [overflow-wrap:anywhere]">
                  {t.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              asChild
              className="absolute right-2.5 top-2.5 rounded-full p-1 text-foreground-muted outline-none hover:bg-surface-sunken"
            >
              <button type="button" aria-label="关闭提示">
                <X className="h-3.5 w-3.5" />
              </button>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        {/* 手机端留出底部标签栏的高度 */}
        <ToastPrimitive.Viewport className="fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 list-none flex-col gap-2 outline-none md:bottom-5 md:left-auto md:right-5 md:translate-x-0" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** 读取 toast() 触发器；必须在 ToastProvider 内使用。 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast 必须在 <ToastProvider> 内使用");
  }
  return ctx;
}
