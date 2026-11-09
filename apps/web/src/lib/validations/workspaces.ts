import { z } from "zod";

export const workspaceNameSchema = z.string().trim().min(2, "Use at least 2 characters.").max(120, "Use at most 120 characters.");
export const workspaceDescriptionSchema = z.string().trim().max(1000, "Use at most 1000 characters.");

export const createWorkspaceSchema = z.object({
  organizationId: z.guid(),
  name: workspaceNameSchema,
  description: workspaceDescriptionSchema.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: workspaceNameSchema.optional(),
  description: workspaceDescriptionSchema.nullable().optional(),
}).refine((value) => value.name !== undefined || value.description !== undefined, "Provide a name or description.");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  workspaceName: workspaceNameSchema,
});

export function slugify(name: string) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63).replace(/-$/g, "");
}
