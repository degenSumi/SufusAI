import type { SendMessageInput } from "@repo/shared";
import { conversationService } from "../services/conversation.service.js";
import { orchestrator } from "../services/orchestrator.service.js";

// Take validated input plus identity, return a payload or a Response. No Hono
// context, so they are directly unit-testable.
export const chatController = {
  /** Streams a full agent turn. Returns a `Response` because the body is SSE. */
  sendMessage(userId: string, input: SendMessageInput): Promise<Response> {
    return orchestrator.handleMessage({
      userId,
      conversationId: input.conversationId,
      message: input.message,
    });
  },

  async listConversations(userId: string, query: { limit: number; offset: number }) {
    const conversations = await conversationService.list(userId, query.limit, query.offset);
    return { conversations, count: conversations.length };
  },

  getConversation(userId: string, conversationId: string) {
    return conversationService.getWithMessages(userId, conversationId);
  },

  async deleteConversation(userId: string, conversationId: string) {
    await conversationService.delete(userId, conversationId);
    return { deleted: true, id: conversationId };
  },
};
