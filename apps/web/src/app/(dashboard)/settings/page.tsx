import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/features/app/context";
import { formatCompact, formatCost, formatInteger } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5 border-b py-2.5 last:border-0 sm:flex-row sm:justify-between"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-sm font-medium sm:text-right">{children}</dd></div>;
}

export default async function SettingsPage() {
  const context = await requireAppContext();
  const [members, usage] = await Promise.all([
    context.supabase.from("organization_members").select("role").eq("organization_id", context.organization.id),
    context.supabase.from("agent_runs").select("input_tokens, output_tokens, estimated_cost_usd").eq("organization_id", context.organization.id).limit(5000),
  ]);
  const roleCounts = (members.data ?? []).reduce<Record<string, number>>((counts, member) => ({ ...counts, [member.role]: (counts[member.role] ?? 0) + 1 }), {});
  const totals = (usage.data ?? []).reduce((sum, run) => ({
    input: sum.input + run.input_tokens, output: sum.output + run.output_tokens, cost: sum.cost + Number(run.estimated_cost_usd),
  }), { input: 0, output: 0, cost: 0 });

  // Display-only, non-secret configuration of this web server. API keys are never read into the page.
  const env = process.env;
  const model = {
    provider: env.LLM_PROVIDER ?? "not set",
    model: env.LLM_MODEL ?? "not set",
    embeddingModel: env.EMBEDDING_MODEL ?? "not set",
    demoMode: env.DEMO_MODE === "true",
    maxSteps: env.MAX_AGENT_STEPS ?? "default (8)",
    maxCost: env.MAX_AGENT_COST_USD ? `$${env.MAX_AGENT_COST_USD}` : "not set",
  };

  return (
    <>
      <PageHeader title="Settings" description="Organization, profile, model configuration, and usage." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Organization</CardTitle><CardDescription>Your role determines what you can change.</CardDescription></CardHeader>
          <CardContent>
            <dl>
              <Row label="Name">{context.organization.name}</Row>
              <Row label="URL slug"><span className="font-mono text-xs">{context.organization.slug}</span></Row>
              <Row label="Your role"><span className="capitalize">{context.role}</span></Row>
              {context.role === "admin" && <Row label="Members">{Object.entries(roleCounts).map(([role, count]) => `${count} ${role}${count === 1 ? "" : "s"}`).join(", ") || "—"}</Row>}
              <Row label="Workspaces">{context.workspaces.length}</Row>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Member invitations and role management are not available yet.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>Signed-in account.</CardDescription></CardHeader>
          <CardContent>
            <dl>
              <Row label="Email">{context.user.email ?? "—"}</Row>
              <Row label="User ID"><span className="font-mono text-xs">{context.user.id}</span></Row>
              <Row label="Organizations">{context.organizations.length}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Model configuration</CardTitle><CardDescription>As configured for this web server. The worker reads its own environment; provider keys are never shown.</CardDescription></CardHeader>
          <CardContent>
            <dl>
              <Row label="LLM provider">{model.provider}</Row>
              <Row label="Chat model">{model.model}</Row>
              <Row label="Embedding model">{model.embeddingModel}</Row>
              <Row label="Demo mode">{model.demoMode ? "On (deterministic demo provider)" : "Off"}</Row>
              <Row label="Max tool steps per run">{model.maxSteps}</Row>
              <Row label="Max estimated cost per run">{model.maxCost}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Usage</CardTitle><CardDescription>Runs visible to you in this organization.</CardDescription></CardHeader>
          <CardContent>
            <dl>
              <Row label="Runs">{formatInteger(usage.data?.length ?? 0)}</Row>
              <Row label="Input tokens">{formatCompact(totals.input)}</Row>
              <Row label="Output tokens">{formatCompact(totals.output)}</Row>
              <Row label="Estimated cost">{formatCost(totals.cost)}</Row>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Costs are estimates from configured per-token prices, not a provider invoice. <a href="/usage" className="text-primary hover:underline">Detailed usage</a></p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
