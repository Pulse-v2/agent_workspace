"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadAppContext, ORGANIZATION_COOKIE } from "./context";

/** Switches the active organization after verifying membership. */
export async function switchOrganization(formData: FormData) {
  const organizationId = z.guid().safeParse(formData.get("organizationId"));
  const result = await loadAppContext();
  if (!organizationId.success || result.status !== "ready") redirect("/dashboard");
  if (result.context.organizations.some((organization) => organization.id === organizationId.data)) {
    (await cookies()).set(ORGANIZATION_COOKIE, organizationId.data, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect("/dashboard");
}
