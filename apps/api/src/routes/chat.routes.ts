import { Hono } from "hono";
import {
  conversationIdParamSchema,
  listConversationsQuerySchema,
  sendMessageSchema,
} from "@repo/shared";
import { chatController } from "../controllers/chat.controller.js";
import { validate } from "../middleware/validate.js";
import { rateLimit } from "../middleware/rate-limit.js";
import type { AppEnv } from "../middleware/context.js";

// One unbroken chain — Hono RPC derives the client's types from this expression.
export const chatRoutes = new Hono<AppEnv>()
  // Rate limited on its own budget: the only endpoint that spends model tokens.
  .post("/messages", rateLimit(), validate("json", sendMessageSchema), async (c) => {
    // Returns the streaming Response directly. Hono passes it through
    // untouched, which is what preserves back-pressure end to end — buffering
    // it into c.json() here would defeat the entire point of streaming.
    return chatController.sendMessage(c.get("userId"), c.req.valid("json"));
  })

  .get("/conversations", validate("query", listConversationsQuerySchema), async (c) => {
    const result = await chatController.listConversations(c.get("userId"), c.req.valid("query"));
    return c.json(result);
  })

  .get("/conversations/:id", validate("param", conversationIdParamSchema), async (c) => {
    const result = await chatController.getConversation(c.get("userId"), c.req.valid("param").id);
    return c.json(result);
  })

  .delete("/conversations/:id", validate("param", conversationIdParamSchema), async (c) => {
    const result = await chatController.deleteConversation(
      c.get("userId"),
      c.req.valid("param").id,
    );
    return c.json(result);
  });
