// Deterministic, credential-free configuration for unit tests. No test talks to a real database or provider.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  LLM_PROVIDER: "demo",
  LLM_MODEL: "test-model",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: "1536",
  WORKER_POLL_INTERVAL_MS: "1000",
  MAX_AGENT_STEPS: "3",
  MAX_AGENT_DURATION_MS: "60000",
  MAX_AGENT_COST_USD: "1",
  MAX_AGENT_RETRIES: "3",
  DEMO_MODE: "true",
});
delete process.env.LLM_API_KEY;
delete process.env.EMBEDDING_API_KEY;
