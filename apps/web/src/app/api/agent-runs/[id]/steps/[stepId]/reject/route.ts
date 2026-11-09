/** POST /api/agent-runs/[id]/steps/[stepId]/reject — body: { reason?: string }. The rejection is returned to the agent. */
import { decisionHandler } from "@/lib/api/approvals";

export const POST = decisionHandler("rejected");
