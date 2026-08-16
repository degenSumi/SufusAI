import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { ValidationError } from "../lib/errors.js";

// zValidator writes its own 400 body, which would be the one response shape that
// differs. Target must stay a literal or RPC infers every target was validated.
export function validate<Schema extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ValidationError(`Invalid ${target}`, {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return undefined;
  });
}
