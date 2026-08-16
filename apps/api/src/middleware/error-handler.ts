import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { AppError, RateLimitError, ValidationError } from "../lib/errors.js";
import { isProduction } from "../config/env.js";
import type { AppEnv } from "./context.js";

// Single exit point for every failure, so the error shape cannot drift.
export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  // Zod escaping a validator: surface the field-level detail, it is genuinely
  // useful to the caller and contains nothing sensitive.
  if (error instanceof ZodError) {
    const validation = new ValidationError("Request validation failed", {
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return c.json(
      { error: { code: validation.code, message: validation.message, requestId, details: validation.details } },
      validation.statusCode,
    );
  }

  if (error instanceof AppError) {
    if (error instanceof RateLimitError) {
      c.header("Retry-After", String(error.retryAfterSeconds));
    }
    // Server-side faults are logged; client mistakes are not, or a scanner
    // sending malformed requests becomes a log flood.
    if (error.statusCode >= 500) {
      console.error(`[${requestId}] ${error.code}: ${error.message}`, error.stack);
    }
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      error.statusCode,
    );
  }

  if (error instanceof HTTPException) {
    return c.json(
      { error: { code: "HTTP_ERROR", message: error.message, requestId } },
      error.status,
    );
  }

  // Anything reaching here is unplanned. Log it in full, tell the client
  // nothing — an unhandled error message can carry connection strings, file
  // paths or SQL.
  console.error(`[${requestId}] Unhandled error:`, error);
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our end.",
        requestId,
        ...(isProduction ? {} : { details: error instanceof Error ? error.message : String(error) }),
      },
    },
    500,
  );
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(
    {
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `No route matches ${c.req.method} ${c.req.path}`,
        requestId: c.get("requestId") ?? "unknown",
      },
    },
    404,
  );
