import { getDb, type Database } from "@repo/db";
import { env } from "./config/env.js";

/**
 * The app's single database handle. Repositories import this; nothing else
 * should. Tests can build their own handle with `createDb()` instead.
 */
export const db: Database = getDb(env.DATABASE_URL);
