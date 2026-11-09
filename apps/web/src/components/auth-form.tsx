"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Command, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const formSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

type FormValues = z.infer<typeof formSchema>;

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { email: "", password: "" } });
  const isSignUp = mode === "sign-up";

  async function onSubmit(values: FormValues) {
    setMessage(null);
    setIsSubmitting(true);
    const supabase = createClient();
    if (!supabase) {
      setMessage("Connect your Supabase project in .env.local to enable account access.");
      setIsSubmitting(false);
      return;
    }

    const result = isSignUp
      ? await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        })
      : await supabase.auth.signInWithPassword(values);

    setIsSubmitting(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (isSignUp && !result.data.session) {
      setMessage("Check your inbox to confirm your email. You can sign in after confirming.");
      return;
    }

    // Only follow internal, same-origin paths from ?next= (prevents open redirects).
    const next = new URLSearchParams(window.location.search).get("next");
    // Full navigation so the new session cookie is used and no cached redirect from the
    // signed-out state is replayed by the client router.
    window.location.assign(next && /^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/dashboard");
  }

  return (
    <main className="flex min-h-screen bg-background">
      <section className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex xl:p-16 dark:bg-card dark:text-card-foreground">
        <div className="absolute -right-32 top-36 size-[420px] rounded-full border border-current opacity-10" />
        <div className="absolute -right-10 top-60 size-[280px] rounded-full border border-current opacity-10" />
        <Link href="/" className="relative flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-current/10"><Command size={19} /></span><span className="text-sm font-semibold">Northstar</span></Link>
        <div className="relative max-w-[420px] pb-10">
          <div className="mb-6 grid size-11 place-items-center rounded-xl border border-current/20"><ShieldCheck size={20} /></div>
          <p className="text-2xl font-medium leading-snug tracking-tight">Build trust into every agent workflow.</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed opacity-70">Review the plan, inspect the evidence, and stay in control of every action.</p>
        </div>
        <p className="relative text-xs opacity-50">Secure workspace access · Private by design</p>
      </section>

      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <Link href="/" className="mb-10 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground lg:hidden"><Command size={16} />Northstar</Link>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AI Agent Workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{isSignUp ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{isSignUp ? "Start a secure workspace for your team." : "Sign in to continue to your workspace."}</p>

          <form className="mt-8 grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" autoComplete="email" type="email" placeholder="you@company.com" className="h-10" aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
              {form.formState.errors.email && <span className="text-xs text-destructive">{form.formState.errors.email.message}</span>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" autoComplete={isSignUp ? "new-password" : "current-password"} type="password" placeholder="At least 8 characters" className="h-10" aria-invalid={Boolean(form.formState.errors.password)} {...form.register("password")} />
              {form.formState.errors.password && <span className="text-xs text-destructive">{form.formState.errors.password.message}</span>}
            </div>
            {message && <p role="status" className="rounded-md border bg-muted px-3 py-2.5 text-sm text-muted-foreground">{message}</p>}
            <Button type="submit" disabled={isSubmitting} className="mt-2 h-10 w-full">
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : <>{isSignUp ? "Create account" : "Sign in"}<ArrowRight /></>}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "New to Northstar?"}{" "}
            <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="font-medium text-primary hover:underline">{isSignUp ? "Sign in" : "Create an account"}</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
