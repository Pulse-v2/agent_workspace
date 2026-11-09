// Real database and Storage from the root .env, but always the deterministic demo
// provider without embeddings so results are reproducible and free.
import "../load-env.js";

process.env.LLM_PROVIDER = "demo";
process.env.DEMO_MODE = "true";
process.env.MAX_AGENT_STEPS = "8";
delete process.env.LLM_API_KEY;
delete process.env.EMBEDDING_API_KEY;
