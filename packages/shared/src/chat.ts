import { z } from "zod";
import { agentTypeSchema, intentSchema, routeSourceSchema } from "./agents.js";

// The client sends only the new message; the server owns history.
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1, "Message cannot be empty").max(4000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const conversationIdParamSchema = z.object({
  id: z.string().uuid("Conversation id must be a UUID"),
});

export const listConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

export const agentTypeParamSchema = z.object({
  type: agentTypeSchema,
});

/** Shape returned by the conversation list endpoint. */
export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  lastAgentType: agentTypeSchema.nullable(),
  messageCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  agentType: agentTypeSchema.nullable(),
  intent: intentSchema.nullable(),
  routeSource: routeSourceSchema.nullable(),
  routeConfidence: z.number().nullable(),
  routeReasoning: z.string().nullable(),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        label: z.string(),
        status: z.string(),
        summary: z.string().optional(),
        durationMs: z.number().optional(),
      }),
    )
    .nullable(),
  totalTokens: z.number().nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof messageSchema>;

/** Every non-streaming error the API returns uses this envelope. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}
