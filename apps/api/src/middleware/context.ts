import type { MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { userRepository } from "../repositories/user.repository.js";
import { AppError } from "../lib/errors.js";

export interface AppEnv {
  Variables: {
    requestId: string;
    userId: string;
  };
}

// Correlates a request across logs and error bodies.
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming ?? randomUUID();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
};

// Stands in for auth. Real sessions would change this function and nothing else
// — every layer below already reads identity from the request context.
export const resolveUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await userRepository.findDemoUser();
  if (!user) {
    throw new AppError(
      "No users exist in the database. Run `pnpm db:seed` before starting the API.",
      503,
      "NOT_SEEDED",
    );
  }
  c.set("userId", user.id);
  await next();
};
