import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** EmptyState：说明现状，并给出明确的下一步。 */

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "surface-card flex flex-col items-center justify-center gap-4 rounded-card px-6 py-14 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.5)]"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <div className="max-w-md space-y-1.5">
        <p className="text-title font-semibold tracking-[-0.01em] text-foreground">{title}</p>
        {description ? (
          <p className="text-label leading-relaxed text-foreground-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
