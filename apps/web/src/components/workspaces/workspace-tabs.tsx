"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function WorkspaceTabs({ workspaceId, counts }: { workspaceId: string; counts: { documents: number; runs: number; artifacts: number } }) {
  const pathname = usePathname();
  const base = `/workspaces/${workspaceId}`;
  const tabs = [
    { label: "Overview", href: base, exact: true },
    { label: "Documents", href: `${base}/documents`, count: counts.documents },
    { label: "Agent runs", href: `${base}/runs`, count: counts.runs },
    { label: "Artifacts", href: `${base}/artifacts`, count: counts.artifacts },
  ];
  return (
    <nav aria-label="Workspace sections" className="-mx-4 mb-6 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined}
              className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {tab.label}
              {tab.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{tab.count}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
