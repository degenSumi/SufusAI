import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "@repo/db";
import { db } from "./db.js";
import { env } from "./config/env.js";
import { describeModels } from "./agents/provider.js";
import { chatRoutes } from "./routes/chat.routes.js";
import { agentRoutes } from "./routes/agent.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestId, resolveUser, type AppEnv } from "./middleware/context.js";

export const app = new Hono<AppEnv>()
  .use("*", requestId)
  .use(
    "*",
    cors({
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      allowHeaders: ["Content-Type", "X-Request-Id"],
      // Without this the browser cannot read the conversation id we return on
      // the first message of a new thread — CORS hides non-safelisted response
      // headers from JS unless they are explicitly exposed.
      exposeHeaders: ["X-Conversation-Id", "X-Request-Id", "X-RateLimit-Remaining"],
    }),
  )

  // Reports the two things that actually break this service: DB and model config.
  .get("/health", async (c) => {
    let database: "up" | "down" = "up";
    try {
      await db.execute(sql`select 1`);
    } catch {
      database = "down";
    }

    const body = {
      status: database === "up" ? ("healthy" as const) : ("degraded" as const),
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, ai: describeModels() },
      timestamp: new Date().toISOString(),
    };

    return c.json(body, database === "up" ? 200 : 503);
  })

  // Identity is resolved once, here, for everything under /api.
  .use("/api/*", resolveUser)
  .route("/api/chat", chatRoutes)
  .route("/api/agents", agentRoutes);

app.onError(errorHandler);
app.notFound(notFoundHandler);

// hc<AppType> on the client derives every route, param and response from this.
export type AppType = typeof app;
