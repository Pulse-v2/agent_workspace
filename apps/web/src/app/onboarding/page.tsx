"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Check, Command, FolderKanban, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormError } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, errorMessage } from "@/lib/api/client";

const setupSchema = z.object({
  organization: z.string().trim().min(2, "Enter at least 2 characters.").max(120),
  workspace: z.string().trim().min(2, "Enter at least 2 characters.").max(120),
});
type SetupValues = z.infer<typeof setupSchema>;

const promises = [
  "Your documents stay private to your organization.",
  "You decide which agent actions are carried out.",
  "Sources remain attached to the answers they support.",
];

export default function OnboardingPage() {
  const form = useForm<SetupValues>({ resolver: zodResolver(setupSchema), defaultValues: { organization: "", workspace: "" } });
  const mutation = useMutation({
    mutationFn: (values: SetupValues) => apiFetch("/api/organizations", { method: "POST", json: { name: values.organization, workspaceName: values.workspace } }),
    // Full navigation: the client router may still hold the earlier "/dashboard → /onboarding"
    // redirect from before the organization existed.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation (see above)
    onSuccess: () => window.location.assign("/dashboard"),
  });

  return (
    <main className="min-h-screen bg-muted/30 px-5 py-8 sm:px-8">
      <div className="mx-auto flex max-w-[940px] items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Command size={16} /></span><span className="text-sm font-semibold">Northstar</span></Link>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Workspace setup</span>
      </div>
      <div className="mx-auto mt-16 grid max-w-[940px] gap-12 md:grid-cols-[1fr_380px] md:items-start">
        <div className="pt-2">
          <div className="grid size-10 place-items-center rounded-xl border bg-background text-muted-foreground"><FolderKanban size={18} /></div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">Make this space yours</h1>
          <p className="mt-2 max-w-[440px] text-sm leading-relaxed text-muted-foreground">Name your organization and its first workspace. You become the organization admin.</p>
          <ul className="mt-9 space-y-4">
            {promises.map((promise) => (
              <li key={promise} className="flex gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground"><Check size={11} /></span>{promise}
              </li>
            ))}
          </ul>
        </div>

        <section className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace details</p>
          <form className="mt-5 grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="organization">Organization name</Label>
              <Input id="organization" placeholder="e.g. Acme Analytics" className="h-10" aria-invalid={Boolean(form.formState.errors.organization)} {...form.register("organization")} />
              <FormError message={form.formState.errors.organization?.message} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="workspace">First workspace</Label>
              <Input id="workspace" placeholder="e.g. Sales research" className="h-10" aria-invalid={Boolean(form.formState.errors.workspace)} {...form.register("workspace")} />
              <FormError message={form.formState.errors.workspace?.message} />
            </div>
            <div className="flex gap-2 rounded-md border bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              <Sparkles size={14} className="mt-0.5 shrink-0" />The organization and workspace are created together; you can add more workspaces later.
            </div>
            <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
            <Button type="submit" disabled={mutation.isPending} className="h-10 w-full">
              {mutation.isPending ? <LoaderCircle className="animate-spin" /> : <>Create workspace<ArrowRight /></>}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
