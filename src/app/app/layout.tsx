import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppProviders } from "@/features/shell/providers";
import { AppShell } from "@/features/shell/app-shell";
import { REQUEST_RETURN_TO_HEADER, loginPathWithReturnTo } from "@/lib/return-to";
import { visiblePagePath } from "@/lib/rate-limited";
import { getPageSessionUser } from "@/server/auth/page-session";

// Private pages share the request-scoped session lookup and charge read quota on the page.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getPageSessionUser();
  if (!user) redirect(loginPathWithReturnTo(visiblePagePath((await headers()).get(REQUEST_RETURN_TO_HEADER))));

  return (
    <AppProviders>
      <AppShell user={user}>{children}</AppShell>
    </AppProviders>
  );
}
