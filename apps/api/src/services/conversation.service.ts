import type { AgentType, ConversationSummary, ChatMessage } from "@repo/shared";
import type { Conversation } from "@repo/db";
import { conversationRepository } from "../repositories/conversation.repository.js";
import { NotFoundError } from "../lib/errors.js";
import { titleFromMessage } from "../lib/format.js";

interface ToolCallRecord {
  toolName: string;
  label: string;
  status: string;
  summary?: string;
  durationMs?: number;
}

export const conversationService = {
  // Always looked up scoped to the caller: an id belonging to someone else is
  // indistinguishable from one that does not exist.
  async resolveForMessage(
    userId: string,
    conversationId: string | undefined,
    firstMessage: string,
  ): Promise<{ conversation: Conversation; isNew: boolean }> {
    if (conversationId) {
      const existing = await conversationRepository.findById(userId, conversationId);
      if (!existing) throw new NotFoundError("Conversation", conversationId);
      return { conversation: existing, isNew: false };
    }

    const created = await conversationRepository.create(userId, titleFromMessage(firstMessage));
    return { conversation: created, isNew: true };
  },

  async list(userId: string, limit: number, offset: number): Promise<ConversationSummary[]> {
    const rows = await conversationRepository.listForUser(userId, limit, offset);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      lastAgentType: row.lastAgentType,
      messageCount: row.messageCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },

  async getWithMessages(
    userId: string,
    conversationId: string,
  ): Promise<{ conversation: ConversationSummary; messages: ChatMessage[] }> {
    const conversation = await conversationRepository.findById(userId, conversationId);
    if (!conversation) throw new NotFoundError("Conversation", conversationId);

    const messages = await conversationRepository.listMessages(conversationId);

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        lastAgentType: conversation.lastAgentType,
        messageCount: messages.length,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        agentType: m.agentType,
        intent: m.intent as ChatMessage["intent"],
        routeSource: m.routeSource as ChatMessage["routeSource"],
        routeConfidence: m.routeConfidence,
        routeReasoning: m.routeReasoning,
        toolCalls: (m.toolCalls as ToolCallRecord[] | null) ?? null,
        totalTokens: m.totalTokens,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  },

  async delete(userId: string, conversationId: string): Promise<void> {
    const deleted = await conversationRepository.delete(userId, conversationId);
    // Messages and summaries go with it via ON DELETE CASCADE — the database
    // owns that invariant, not this service.
    if (!deleted) throw new NotFoundError("Conversation", conversationId);
  },

  async recordUserMessage(conversationId: string, content: string) {
    return conversationRepository.addMessage({ conversationId, role: "user", content });
  },

  async recordAssistantMessage(input: {
    conversationId: string;
    content: string;
    agentType: AgentType;
    intent: string;
    routeSource: string;
    routeConfidence: number;
    routeReasoning: string;
    toolCalls: ToolCallRecord[];
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }) {
    const message = await conversationRepository.addMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content: input.content,
      agentType: input.agentType,
      intent: input.intent,
      routeSource: input.routeSource,
      routeConfidence: input.routeConfidence,
      routeReasoning: input.routeReasoning,
      toolCalls: input.toolCalls.length > 0 ? input.toolCalls : null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
    });

    await conversationRepository.touch(input.conversationId, input.agentType);
    return message;
  },
};
