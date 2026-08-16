import {
  and,
  asc,
  conversations,
  conversationSummaries,
  desc,
  eq,
  count,
  ilike,
  messages,
  type Conversation,
  type ConversationSummaryRow,
  type Message,
  type NewMessage,
} from "@repo/db";
import type { AgentType } from "@repo/shared";
import { db } from "../db.js";

export interface ConversationListRow {
  id: string;
  title: string;
  lastAgentType: AgentType | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HistorySearchHit {
  conversationId: string;
  conversationTitle: string;
  role: string;
  content: string;
  agentType: AgentType | null;
  createdAt: Date;
}

export const conversationRepository = {
  async create(userId: string, title: string): Promise<Conversation> {
    const [row] = await db.insert(conversations).values({ userId, title }).returning();
    if (!row) throw new Error("Failed to create conversation");
    return row;
  },

  async findById(userId: string, id: string): Promise<Conversation | null> {
    const [row] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .limit(1);
    return row ?? null;
  },

  async listForUser(userId: string, limit: number, offset: number): Promise<ConversationListRow[]> {
    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        lastAgentType: conversations.lastAgentType,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        // LEFT JOIN + GROUP BY rather than a correlated subquery: counting the
        // joined id (not `*`) means a conversation with no messages still
        // appears, with a count of zero, because the outer-joined id is NULL.
        messageCount: count(messages.id),
      })
      .from(conversations)
      .leftJoin(messages, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.userId, userId))
      .groupBy(conversations.id)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);

    return rows as ConversationListRow[];
  },

  async delete(userId: string, id: string): Promise<boolean> {
    const deleted = await db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning({ id: conversations.id });
    return deleted.length > 0;
  },

  /** Bumps `updatedAt` and records which agent handled the latest turn. */
  async touch(id: string, lastAgentType: AgentType): Promise<void> {
    await db
      .update(conversations)
      .set({ lastAgentType, updatedAt: new Date() })
      .where(eq(conversations.id, id));
  },

  async addMessage(message: NewMessage): Promise<Message> {
    const [row] = await db.insert(messages).values(message).returning();
    if (!row) throw new Error("Failed to persist message");
    return row;
  },

  async listMessages(conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  },

  // ILIKE is enough at seed scale and keeps a tsvector column out of the schema.
  async searchHistory(userId: string, query: string, limit = 6): Promise<HistorySearchHit[]> {
    const rows = await db
      .select({
        conversationId: messages.conversationId,
        conversationTitle: conversations.title,
        role: messages.role,
        content: messages.content,
        agentType: messages.agentType,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.userId, userId), ilike(messages.content, `%${query}%`)))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return rows as HistorySearchHit[];
  },

  async latestSummary(conversationId: string): Promise<ConversationSummaryRow | null> {
    const [row] = await db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, conversationId))
      .orderBy(desc(conversationSummaries.createdAt))
      .limit(1);
    return row ?? null;
  },

  async addSummary(input: {
    conversationId: string;
    summary: string;
    coversThroughMessageId: string;
    messageCount: number;
    tokenEstimate: number;
  }): Promise<void> {
    await db.insert(conversationSummaries).values(input);
  },
};
