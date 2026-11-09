import { agentRunStatuses } from "@ai-agent/shared";
import { z } from "zod";
import { paginationSchema } from "@/lib/validations/pagination";

export const createAgentRunSchema = z.object({
  workspaceId: z.guid(),
  title: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(10, "Describe the task in at least 10 characters.").max(12000),
  documentIds: z.array(z.guid()).max(50).default([]),
});
export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>;

export const listAgentRunsQuerySchema = paginationSchema.extend({
  workspaceId: z.guid().optional(),
  status: z.enum(agentRunStatuses).optional(),
});

export const idParamSchema = z.guid();
