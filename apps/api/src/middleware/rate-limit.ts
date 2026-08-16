import type { MiddlewareHandler } from "hono";
import { RateLimitError } from "../lib/errors.js";
import { env } from "../config/env.js";
import type { AppEnv } from "./context.js";

interface Bucket {
  /** Timestamps of requests still inside the window. */
  hits: number[];
}

// Sliding rather than fixed: a fixed window lets a caller fire the full quota
// either side of the boundary. In-process, so behind N instances the limit is N x.
const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound when callers come and go. */
function sweep(now: number, windowMs: number) {
  for (const [key, bucket] of buckets) {
    const live = bucket.hits.filter((t) => now - t < windowMs);
    if (live.length === 0) buckets.delete(key);
    else bucket.hits = live;
  }
}

let lastSweep = Date.now();

export function rateLimit(options?: {
  windowMs?: number;
  max?: number;
}): MiddlewareHandler<AppEnv> {
  const windowMs = options?.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const max = options?.max ?? env.RATE_LIMIT_MAX_REQUESTS;

  return async (c, next) => {
    const now = Date.now();

    if (now - lastSweep > windowMs) {
      sweep(now, windowMs);
      lastSweep = now;
    }

    // Prefer the authenticated identity; fall back to the forwarded IP so an
    // unauthenticated caller cannot dodge the limit by omitting credentials.
    const identity =
      c.get("userId") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "anonymous";

    const bucket = buckets.get(identity) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    const remaining = Math.max(max - bucket.hits.length - 1, 0);
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));

    if (bucket.hits.length >= max) {
      const oldest = bucket.hits[0] ?? now;
      const retryAfter = Math.max(Math.ceil((oldest + windowMs - now) / 1000), 1);
      buckets.set(identity, bucket);
      throw new RateLimitError(retryAfter);
    }

    bucket.hits.push(now);
    buckets.set(identity, bucket);

    await next();
  };
}

/** Test seam — the limiter is module state, so tests need a way to reset it. */
export function resetRateLimiter() {
  buckets.clear();
}
