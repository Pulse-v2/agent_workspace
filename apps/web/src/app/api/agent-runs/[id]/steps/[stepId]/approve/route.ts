/** POST /api/agent-runs/[id]/steps/[stepId]/approve — body: { reason?: string } */
import { decisionHandler } from "@/lib/api/approvals";

export const POST = decisionHandler("approved");
