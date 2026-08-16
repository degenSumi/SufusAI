import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Env lives at the repo root so one file serves every workspace package.
config({ path: "../../.env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — add it to the repo-root .env file.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  // No interactive confirmation — `db:push` must run unattended in setup scripts.
  strict: false,
});
