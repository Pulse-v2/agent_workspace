import { Command } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/** Static loading shell shown while the session and organization load. */
export function ShellSkeleton() {
  return (
    <div className="min-h-screen bg-muted/30" aria-busy="true" aria-label="Loading workspace">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-background lg:block">
        <div className="flex h-14 items-center gap-2.5 border-b px-5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Command className="size-4" /></span>
          <span className="text-sm font-semibold">Northstar</span>
        </div>
        <div className="space-y-2 p-3">
          <Skeleton className="h-11 w-full" />
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}
        </div>
      </aside>
      <div className="lg:pl-64">
        <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
          <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    </div>
  );
}
