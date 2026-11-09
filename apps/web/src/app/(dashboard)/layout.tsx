import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellSkeleton } from "@/components/layout/shell-skeleton";
import { countPendingApprovals } from "@/features/agent-runs/queries";
import { requireAppContext } from "@/features/app/context";

/**
 * With Cache Components, reading the session (cookies) must happen behind a
 * Suspense boundary. The skeleton is the static shell; the authenticated shell
 * and the page stream in once the session and organization are resolved.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const context = await requireAppContext();
  const pendingApprovals = await countPendingApprovals(context);
  return (
    <AppShell
      organizations={context.organizations}
      organization={context.organization}
      workspaces={context.workspaces}
      userEmail={context.user.email}
      pendingApprovals={pendingApprovals}
    >
      {children}
    </AppShell>
  );
}
