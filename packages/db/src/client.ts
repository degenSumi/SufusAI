import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>;

// prepare: false is required for Neon's pooled endpoint (pgBouncer).
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });
  return drizzle(client, { schema });
}

let singleton: Database | undefined;

/**
 * Lazy singleton. Deliberately *not* initialised at import time so that
 * importing schema types in tests doesn't demand a live DATABASE_URL.
 */
export function getDb(connectionString?: string): Database {
  if (!singleton) {
    const url = connectionString ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.",
      );
    }
    singleton = createDb(url);
  }
  return singleton;
}
