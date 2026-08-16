/**
 * Test environment.
 *
 * `config/env.ts` validates the environment at import time and throws if a
 * provider key is missing — good behaviour in production, fatal in CI. These
 * placeholders satisfy the schema; no test in this suite opens a socket, so
 * nothing ever tries to use them.
 */
process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
process.env["AI_PROVIDER"] = "google";
process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = "test-key-not-used";
process.env["RATE_LIMIT_WINDOW_MS"] = "1000";
process.env["RATE_LIMIT_MAX_REQUESTS"] = "3";
process.env["CONTEXT_TOKEN_BUDGET"] = "200";
process.env["CONTEXT_KEEP_RECENT_MESSAGES"] = "2";
