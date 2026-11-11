"use client";

import Link from "next/link";
import { LinkLabel, Segments } from "@/components/ui";
import { cn } from "@/lib/cn";

/** 成员分区里的两页：成员名单和邀请链接。邀请只有项目所有者能管理，所以只给所有者显示。 */
export function MemberTabs({
  projectId,
  active,
  className,
}: {
  projectId: string;
  active: "members" | "invitations";
  className?: string;
}) {
  const tabs = [
    { key: "members", label: "成员" },
    { key: "invitations", label: "邀请" },
  ] as const;
  return (
    <nav aria-label="成员与邀请" className={className}>
      <Segments activeKey={active} className="inline-flex rounded-full bg-surface-sunken p-1">
        {tabs.map(({ key, label }) => (
          <Link
            key={key}
            href={`/app/projects/${projectId}/${key}`}
            aria-current={active === key ? "page" : undefined}
            data-active={active === key || undefined}
            className={cn(
              "flex h-8 items-center rounded-full px-4 text-label font-medium outline-none transition-colors duration-200",
              active === key ? "text-foreground" : "text-foreground-secondary hover:text-foreground",
            )}
          >
            <LinkLabel>{label}</LinkLabel>
          </Link>
        ))}
      </Segments>
    </nav>
  );
}
