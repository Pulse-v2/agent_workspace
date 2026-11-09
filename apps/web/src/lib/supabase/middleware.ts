import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";
import type { Database } from "./database.types";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getPublicSupabaseEnv();

  if (!env) return response;

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          if (headers) {
            for (const [name, value] of Object.entries(headers)) {
              response.headers.set(name, value);
            }
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getClaims();
  const isAuthenticated = !error && Boolean(data?.claims);
  const path = request.nextUrl.pathname;
  const isPublicRoute = path === "/sign-in" || path === "/sign-up" || path.startsWith("/auth/");

  if (!isPublicRoute && !isAuthenticated) {
    const signInUrl = new URL("/sign-in", request.url);
    if (path !== "/") signInUrl.searchParams.set("next", path);
    return NextResponse.redirect(signInUrl);
  }
  if (isAuthenticated && (path === "/sign-in" || path === "/sign-up")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}
