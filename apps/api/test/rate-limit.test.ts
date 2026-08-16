import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import { rateLimit, resetRateLimiter } from "../src/middleware/rate-limit.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestId, type AppEnv } from "../src/middleware/context.js";
import { validate } from "../src/middleware/validate.js";
import { sendMessageSchema } from "@repo/shared";

/**
 * The middleware stack exercised through a real Hono app rather than by calling
 * the handlers directly — that is the only way to prove the pieces compose:
 * that a throw from deep inside a validator still lands in the error handler
 * with the right status and the right body shape.
 *
 * The test env sets the window to 3 requests / 1000ms.
 */
function buildApp() {
  const app = new Hono<AppEnv>()
    .use("*", requestId)
    .use("/limited", rateLimit())
    .get("/limited", (c) => c.json({ ok: true }))
    .post("/validated", validate("json", sendMessageSchema), (c) =>
      c.json({ received: c.req.valid("json") }),
    );
  app.onError(errorHandler);
  return app;
}

beforeEach(() => resetRateLimiter());

describe("rate limiting", () => {
  it("allows requests up to the configured maximum", async () => {
    const app = buildApp();

    for (let i = 0; i < 3; i++) {
      const response = await app.request("/limited", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      expect(response.status).toBe(200);
    }
  });

  it("returns 429 with Retry-After once the window is full", async () => {
    const app = buildApp();
    const headers = { "x-forwarded-for": "10.0.0.2" };

    for (let i = 0; i < 3; i++) await app.request("/limited", { headers });
    const blocked = await app.request("/limited", { headers });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();

    const body = (await blocked.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(body.error.requestId).toBeTruthy();
  });

  it("counts each caller separately", async () => {
    const app = buildApp();

    for (let i = 0; i < 3; i++) {
      await app.request("/limited", { headers: { "x-forwarded-for": "10.0.0.3" } });
    }

    // A different caller must be unaffected by the first one's spending.
    const other = await app.request("/limited", { headers: { "x-forwarded-for": "10.0.0.4" } });
    expect(other.status).toBe(200);
  });

  it("advertises the remaining budget on every response", async () => {
    const app = buildApp();
    const response = await app.request("/limited", {
      headers: { "x-forwarded-for": "10.0.0.5" },
    });

    expect(response.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("2");
  });

  it("frees the budget once the window has passed", async () => {
    const app = buildApp();
    const headers = { "x-forwarded-for": "10.0.0.6" };

    for (let i = 0; i < 3; i++) await app.request("/limited", { headers });
    expect((await app.request("/limited", { headers })).status).toBe(429);

    // A sliding window: the oldest hit ages out, it does not reset in blocks.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await app.request("/limited", { headers })).status).toBe(200);
  });
});

describe("validation errors", () => {
  it("rejects an empty message with a 400 in the standard envelope", async () => {
    const app = buildApp();

    const response = await app.request("/validated", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details: { issues: Array<{ path: string }> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.issues[0]?.path).toBe("message");
  });

  it("rejects a non-UUID conversation id", async () => {
    const app = buildApp();

    const response = await app.request("/validated", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", conversationId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
  });

  it("accepts a valid payload", async () => {
    const app = buildApp();

    const response = await app.request("/validated", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "  where is my order  " }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { received: { message: string } };
    // Schema trims, so downstream never sees incidental whitespace.
    expect(body.received.message).toBe("where is my order");
  });
});
