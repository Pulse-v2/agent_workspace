import { SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Shown for missing resources and for resources the user cannot access (deliberately indistinguishable). */
export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground"><SearchX className="size-6" /></span>
      <h1 className="mt-4 text-lg font-semibold">Not found</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">This page does not exist, or it belongs to an organization you are not a member of.</p>
      <Link href="/dashboard" className={`${buttonVariants({ variant: "outline" })} mt-5`}>Back to dashboard</Link>
    </div>
  );
}
