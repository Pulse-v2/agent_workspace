export const organizationRoles = ["admin", "member", "viewer"] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

export const agentRunStatuses = [
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const activeAgentRunStatuses = ["queued", "planning", "running", "waiting_approval"] as const satisfies readonly AgentRunStatus[];

/** Event types written to agent_run_events. Each run's events carry a gap-free, increasing sequence. */
export const agentRunEventTypes = [
  "run_created",
  "run_started",
  "run_retrying",
  "plan_created",
  "step_started",
  "step_completed",
  "step_failed",
  "tool_call_started",
  "tool_call_completed",
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "run_completed",
  "run_failed",
  "run_cancelled",
] as const;

export type AgentRunEventType = (typeof agentRunEventTypes)[number];

export const agentRunStepTypes = ["planning", "retrieval", "tool", "analysis", "final"] as const;
export type AgentRunStepType = (typeof agentRunStepTypes)[number];

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export const jobTypes = ["agent_run", "document_process"] as const;
export type JobType = (typeof jobTypes)[number];

export type ClaimedJob = {
  id: string;
  organization_id: string;
  workspace_id: string;
  run_id: string | null;
  document_id: string | null;
  job_type: JobType;
  payload: Json;
  status: "running";
  attempts: number;
  max_attempts: number;
  locked_by: string;
  lease_expires_at: string;
};
