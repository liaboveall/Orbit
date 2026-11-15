"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Toast（基于 Radix）与轻量的 Provider / useToast。
 *
 * Toast 只用于瞬时确认，不能是唯一的错误反馈：错误同时由 InlineError 驻留显示。
 * Radix 管理 aria-live 宣告和自动消失，不抢焦点；悬停、聚焦和窗口失焦时暂停计时，
 * F8 把焦点移到提示区。可以带一个操作（例如「撤销」），带操作的提示停留更久。
 */

export type ToastVariant = "info" | "success" | "danger";

export type ToastAction = {
  label: string;
  /** 给读屏的替代说明：不能点击提示时，如何完成同样的事。 */
  altText: string;
  onSelect: () => void;
};

type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
};

type ToastItem = Required<Pick<ToastInput, "title" | "variant">> & {
  id: number;
  description?: string;
  duration: number;
  action?: ToastAction;
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

/** 同时最多显示几条：更早的让位，免得叠成一摞挡住内容。 */
const MAX_VISIBLE = 3;

/** 放进新的一条；超出上限时先让最早的纯提示让位，带操作的（例如「撤销」）尽量留到它自己到时。 */
function withLimit(toasts: ToastItem[], next: ToastItem): ToastItem[] {
  const all = [...toasts, next];
  while (all.length > MAX_VISIBLE) {
    const plain = all.findIndex((item, index) => index < all.length - 1 && !item.action);
    all.splice(plain >= 0 ? plain : 0, 1);
  }
  return all;
}

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
      duration: input.duration ?? (input.action ? 8000 : 4000),
      action: input.action,
    };
    setToasts((prev) => withLimit(prev, item));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" swipeThreshold={60}>
        {children}
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            data-lens=""
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            className={
              "glass-menu relative flex w-[min(92vw,360px)] items-start gap-3 rounded-card py-3 pl-4 pr-10 text-foreground " +
              "data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out " +
              // 跟手滑动；松手未过阈值时弹回，过了就顺势滑出。
              "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] " +
              "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=cancel]:duration-200 data-[swipe=cancel]:ease-out " +
              "data-[swipe=end]:animate-toast-swipe-out"
            }
          >
            <span className="mt-0.5 shrink-0">{variantIcon[t.variant]}</span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <ToastPrimitive.Title className="text-label font-semibold">{t.title}</ToastPrimitive.Title>
              {t.description ? (
                <ToastPrimitive.Description className="text-caption text-foreground-secondary [overflow-wrap:anywhere]">
                  {t.description}
                </ToastPrimitive.Description>
              ) : null}
              {t.action ? (
                <ToastPrimitive.Action
                  altText={t.action.altText}
                  onClick={t.action.onSelect}
                  className="press -ml-2 mt-1 inline-flex h-8 items-center rounded-full px-2 text-label font-medium text-brand-ink outline-none transition-[background-color,transform] duration-200 hover:bg-brand-soft"
                >
                  {t.action.label}
                </ToastPrimitive.Action>
              ) : null}
            </div>
            <ToastPrimitive.Close
              asChild
              className="absolute right-2.5 top-2.5 rounded-full p-1 text-foreground-muted outline-none transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <button type="button" aria-label="关闭提示">
                <X className="h-3.5 w-3.5" />
              </button>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        {/* 手机端留出底部标签栏的高度 */}
        <ToastPrimitive.Viewport
          label="通知（{hotkey}）"
          className="fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 list-none flex-col gap-2 outline-none md:bottom-5 md:left-auto md:right-5 md:translate-x-0"
        />
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
