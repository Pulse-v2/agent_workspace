import type { PostgrestError, SupabaseClient, User } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Consistent JSON envelope for every route handler:
 *   success: { data, meta? }
 *   failure: { error: { code, message, details? } }
 * Messages are safe for end users; internal database or provider errors are never echoed.
 */
export type ApiErrorCode =
  | "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "service_unavailable" | "internal_error";

const statusByCode: Record<ApiErrorCode, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, service_unavailable: 503, internal_error: 500,
};

export function ok<T>(data: T, init: { status?: number; meta?: Record<string, unknown> } = {}) {
  return Response.json(init.meta ? { data, meta: init.meta } : { data }, { status: init.status ?? 200 });
}

export function fail(code: ApiErrorCode, message: string, details?: unknown) {
  return Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status: statusByCode[code] });
}

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}

/** Maps PostgREST/Postgres errors to safe API errors. Unknown errors become a generic 500. */
export function fromPostgrestError(error: PostgrestError, fallback = "The request could not be completed."): ApiError {
  if (error.code === "42501") return new ApiError("forbidden", "You do not have permission to perform this action.");
  if (error.code === "PGRST116") return new ApiError("not_found", "The requested resource was not found.");
  if (error.code === "23505") return new ApiError("conflict", "The resource already exists.");
  if (error.code === "22023" || error.code === "23514" || error.code === "22P02") return new ApiError("bad_request", fallback);
  console.error("Database request failed", { code: error.code });
  return new ApiError("internal_error", fallback);
}

export type AuthedContext = { supabase: SupabaseClient<Database>; user: User };

/**
 * Wraps a handler with authentication and error mapping. The user is verified
 * with Supabase Auth on every request; data access then runs under the user's
 * session so RLS remains the final authorization boundary.
 */
export function withAuth<Args extends unknown[]>(handler: (context: AuthedContext, ...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      // Authenticated handlers always run at request time; never prerender them.
      await connection();
      const request = args.find((arg): arg is Request => arg instanceof Request);
      if (request && !isSameOriginMutation(request)) return fail("forbidden", "Cross-site requests are not allowed.");
      const supabase = await createClient();
      if (!supabase) return fail("service_unavailable", "Workspace storage is not configured.");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return fail("unauthorized", "Sign in is required.");
      return await handler({ supabase, user }, ...args);
    } catch (error) {
      // Let Next.js control-flow errors (redirect, notFound, prerender bailouts) propagate.
      unstable_rethrow(error);
      if (error instanceof ApiError) return fail(error.code, error.message, error.details);
      if (error instanceof z.ZodError) {
        return fail("bad_request", "The request is invalid.", error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
      }
      console.error("Unhandled route error", { name: error instanceof Error ? error.name : typeof error });
      return fail("internal_error", "Something went wrong. Please try again.");
    }
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Defense in depth against CSRF for cookie-authenticated mutations (session
 * cookies are already SameSite=Lax): if the browser sends an Origin header, it
 * must match the request host.
 */
export function isSameOriginMutation(request: Request) {
  if (SAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("bad_request", "The request body must be valid JSON.");
  }
}

export { pageRange, paginationSchema } from "@/lib/validations/pagination";
