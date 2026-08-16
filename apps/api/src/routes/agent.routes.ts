import { Hono } from "hono";
import { agentTypeParamSchema } from "@repo/shared";
import { agentController } from "../controllers/agent.controller.js";
import { validate } from "../middleware/validate.js";
import type { AppEnv } from "../middleware/context.js";

export const agentRoutes = new Hono<AppEnv>()
  .get("/", (c) => c.json(agentController.listAgents()))

  /**
   * `:type` is validated against the agent enum, so an unknown agent is a 400
   * from the validator rather than an undefined lookup deeper in the app.
   */
  .get("/:type/capabilities", validate("param", agentTypeParamSchema), (c) =>
    c.json(agentController.getCapabilities(c.req.valid("param").type)),
  );
