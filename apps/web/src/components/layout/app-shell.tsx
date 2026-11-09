"use client";

import {
  BarChart3, BookOpenText, Check, ChevronsUpDown, Command, FileText, FolderKanban, LayoutDashboard, LogOut, Menu, Plus,
  Settings, ShieldCheck, Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { switchOrganization } from "@/features/app/actions";
import type { OrganizationSummary, WorkspaceSummary } from "@/features/app/context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

type ShellProps = {
  organizations: OrganizationSummary[];
  organization: OrganizationSummary;
  workspaces: WorkspaceSummary[];
  userEmail: string | null;
  pendingApprovals: number;
  children: ReactNode;
};

const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Workspaces", href: "/workspaces", icon: FolderKanban },
  { label: "Agent runs", href: "/agent-runs", icon: Workflow },
  { label: "Approvals", href: "/approvals", icon: ShieldCheck },
  { label: "Reports", href: "/artifacts", icon: FileText },
  { label: "Usage", href: "/usage", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function AppShell(props: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-background lg:flex">
        <SidebarContent {...props} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent {...props} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur sm:px-6 lg:hidden">
          <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></Button>
          <span className="flex items-center gap-2 text-sm font-semibold"><Command className="size-4" />Northstar</span>
          <div className="ml-auto"><ThemeToggle /></div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-6 [overflow-wrap:anywhere] sm:px-6 lg:px-8 lg:py-8">{props.children}</main>
      </div>
    </div>
  );
}

function SidebarContent({ organizations, organization, workspaces, userEmail, pendingApprovals, onNavigate }: Omit<ShellProps, "children"> & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [switching, startTransition] = useTransition();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const signOut = async () => {
    await createClient()?.auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
  const selectOrganization = (organizationId: string) => {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    startTransition(() => switchOrganization(formData));
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b px-5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Command className="size-4" /></span>
        <div className="leading-tight"><p className="text-sm font-semibold">Northstar</p><p className="text-xs text-muted-foreground">AI agent workspace</p></div>
      </div>

      <div className="px-3 pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className="flex w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-left hover:bg-muted disabled:opacity-60" disabled={switching} />}>
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground">{organization.name.slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{organization.name}</span><span className="block text-xs capitalize text-muted-foreground">{organization.role}</span></span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {organizations.map((item) => (
                <DropdownMenuItem key={item.id} onClick={() => item.id !== organization.id && selectOrganization(item.id)}>
                  <span className="flex-1 truncate">{item.name}</span>
                  {item.id === organization.id && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/onboarding")}><Plus className="size-4" />New organization</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="space-y-0.5 px-3 pt-4" aria-label="Main navigation">
        {navigation.map(({ label, href, icon: Icon }) => (
          <Link key={href} href={href} onClick={onNavigate} aria-current={isActive(href) ? "page" : undefined}
            className={cn("flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors", isActive(href) ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <Icon className="size-4" />{label}
            {href === "/approvals" && pendingApprovals > 0 && <Badge className="ml-auto bg-warning/20 text-[11px] text-foreground">{pendingApprovals}</Badge>}
          </Link>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-6">
        <div className="flex items-center justify-between px-2.5 pb-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Workspaces</p>
          <Link href="/workspaces?create=1" onClick={onNavigate} aria-label="Create workspace" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-3.5" /></Link>
        </div>
        {workspaces.length === 0 ? <p className="px-2.5 text-xs text-muted-foreground">No workspaces yet.</p> : workspaces.map((workspace) => (
          <Link key={workspace.id} href={`/workspaces/${workspace.id}`} onClick={onNavigate}
            className={cn("flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm", pathname.startsWith(`/workspaces/${workspace.id}`) ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <BookOpenText className="size-3.5 shrink-0" /><span className="truncate">{workspace.name}</span>
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t p-3">
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted" />}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">{(userEmail ?? "U").slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 truncate text-sm">{userEmail ?? "Account"}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => router.push("/settings")}><Settings className="size-4" />Settings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void signOut()}><LogOut className="size-4" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>
    </div>
  );
}
