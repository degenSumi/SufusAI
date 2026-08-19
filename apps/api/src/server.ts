import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { describeModels } from "./agents/provider.js";

// Local dev only. Vercel serves the default export from index.ts.
export default app;

if (!process.env["VERCEL"]) {
  const { provider, models } = describeModels();

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`\n  Sufus Support API`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  http://localhost:${info.port}`);
    console.log(`  env       ${env.NODE_ENV}`);
    console.log(`  provider  ${provider}`);
    console.log(`  router    ${models.router}`);
    console.log(`  agents    ${models.agent}`);
    console.log(`  fallback  ${describeModels().fallback ?? "disabled"}`);
    console.log(`  cors      ${env.CORS_ORIGIN}\n`);
  });
}
