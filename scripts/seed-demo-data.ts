/**
 * Entry point for `pnpm seed:demo`. The implementation lives in the worker
 * package because it runs the real ingestion pipeline and agent engine.
 */
import "../apps/worker/src/demo/seed-demo-data.ts";
