import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicSupabaseEnv = z.infer<typeof publicEnvSchema>;

export function getPublicSupabaseEnv(): PublicSupabaseEnv | null {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  if (!values.NEXT_PUBLIC_SUPABASE_URL && !values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }

  const result = publicEnvSchema.safeParse(values);

  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid Supabase public environment configuration: ${details}`);
  }
  return result.data;
}

