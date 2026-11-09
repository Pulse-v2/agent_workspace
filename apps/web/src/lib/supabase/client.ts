"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@/lib/env";
import type { Database } from "./database.types";

let client: SupabaseClient<Database> | null = null;

export function createClient(): SupabaseClient<Database> | null {
  if (client) return client;

  const env = getPublicSupabaseEnv();
  if (!env) return null;

  client = createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  return client;
}
