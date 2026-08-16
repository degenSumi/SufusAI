import { config } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";


const here = path.dirname(fileURLToPath(import.meta.url));
for (const dir of [process.cwd(), here]) {
  let candidate = dir;
  for (let up = 0; up <= 5; up++) {
    const envPath = path.join(candidate, ".env");
    if (existsSync(envPath)) {
      config({ path: envPath });
      break;
    }
    candidate = path.dirname(candidate);
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3001),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    AI_PROVIDER: z.enum(["google", "openai", "openrouter", "gateway"]).default("google"),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    AI_GATEWAY_API_KEY: z.string().optional(),

    ROUTER_MODEL: z.string().optional(),
    AGENT_MODEL: z.string().optional(),
    SUMMARY_MODEL: z.string().optional(),

    /**
     * Optional second provider used only when the primary fails with a
     * retryable error. Requires OPENROUTER_API_KEY. Leave unset to disable.
     */
    FALLBACK_MODEL: z.string().optional(),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),

    CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(6_000),
    CONTEXT_KEEP_RECENT_MESSAGES: z.coerce.number().int().positive().default(8),

    CORS_ORIGIN: z.string().default("http://localhost:5173"),
  })
  /**
   * Fail at boot, not on the first chat request. A missing provider key is a
   * config error, and config errors should be loud and immediate.
   */
  .superRefine((env, ctx) => {
    const requiredKey = {
      google: "GOOGLE_GENERATIVE_AI_API_KEY",
      openai: "OPENAI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      gateway: "AI_GATEWAY_API_KEY",
    } as const;

    const keyName = requiredKey[env.AI_PROVIDER];
    if (!env[keyName]) {
      ctx.addIssue({
        code: "custom",
        path: [keyName],
        message: `AI_PROVIDER is "${env.AI_PROVIDER}" so ${keyName} must be set.`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the blanks.`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
