import { generateText, type ModelMessage } from "ai";
import type { AgentType } from "@repo/shared";
import type { Message } from "@repo/db";
import { conversationRepository } from "../repositories/conversation.repository.js";
import { getModel } from "../agents/provider.js";
import { env } from "../config/env.js";
import { estimateTokens } from "../lib/format.js";

export interface ConversationContext {
  /** Ready to hand to a sub-agent. */
  modelMessages: ModelMessage[];
  /** Rolling summary of everything compacted so far, if any. */
  summary: string | null;
  /** Verbatim tail, used by the router to resolve pronouns. */
  recentTurns: Array<{ role: string; content: string; agentType?: AgentType | null }>;
  lastAgentType: AgentType | null;
  /** Telemetry surfaced to the UI so compaction is visible, not magic. */
  stats: {
    totalMessages: number;
    messagesInWindow: number;
    summarisedMessages: number;
    estimatedTokens: number;
    compacted: boolean;
  };
}

function toModelMessage(message: Message): ModelMessage | null {
  if (message.role === "user") return { role: "user", content: message.content };
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  return null;
}

// Support summaries have to keep identifiers — losing ORD-1023 makes the next
// "where is it?" unanswerable.
const COMPACTION_INSTRUCTIONS = `You compress customer support conversations so a support agent can pick them up mid-thread.

Preserve, always:
- every order, invoice and refund number mentioned
- what the customer actually wanted, and whether they got it
- any commitment made to the customer (refund raised, cancellation processed, callback promised)
- unresolved threads and open questions

Discard: greetings, pleasantries, restated questions, and the agent's own explanations of things already resolved.

Write compact third-person notes under 200 words. No preamble, no "the customer said" padding — just the facts a colleague needs.`;

async function summarise(existingSummary: string | null, messages: Message[]): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Customer" : `Agent(${m.agentType ?? "support"})`}: ${m.content}`)
    .join("\n");

  const prompt = existingSummary
    ? `Existing notes:\n${existingSummary}\n\nNew turns to fold in:\n${transcript}\n\nProduce updated notes covering both.`
    : `Conversation so far:\n${transcript}\n\nProduce the notes.`;

  const result = await generateText({
    model: getModel("summary"),
    instructions: COMPACTION_INSTRUCTIONS,
    temperature: 0,
    prompt,
  });

  return result.text.trim();
}

export const contextService = {
  // Compaction is checkpointed in the database, so a long conversation is
  // summarised incrementally rather than re-summarised every turn.
  async build(conversationId: string): Promise<ConversationContext> {
    const allMessages = await conversationRepository.listMessages(conversationId);
    const existing = await conversationRepository.latestSummary(conversationId);

    let summary = existing?.summary ?? null;
    let summarisedCount = existing?.messageCount ?? 0;

    // Messages after the last compaction checkpoint are the "live" window.
    let live = allMessages;
    if (existing?.coversThroughMessageId) {
      const idx = allMessages.findIndex((m) => m.id === existing.coversThroughMessageId);
      if (idx >= 0) live = allMessages.slice(idx + 1);
    }

    const budget = env.CONTEXT_TOKEN_BUDGET;
    const keepRecent = env.CONTEXT_KEEP_RECENT_MESSAGES;

    const tokensOf = (msgs: Message[]) =>
      msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0) +
      (summary ? estimateTokens(summary) : 0);

    let compacted = false;
    let estimated = tokensOf(live);

    if (estimated > budget && live.length > keepRecent) {
      const toCompact = live.slice(0, live.length - keepRecent);
      const checkpoint = toCompact.at(-1);

      // Summarising a single message trades a real message for a lossy
      // paraphrase of it — never a win. Only compact a meaningful block.
      if (checkpoint && toCompact.length >= 2) {
        summary = await summarise(summary, toCompact);
        summarisedCount += toCompact.length;

        await conversationRepository.addSummary({
          conversationId,
          summary,
          coversThroughMessageId: checkpoint.id,
          messageCount: summarisedCount,
          tokenEstimate: estimateTokens(summary),
        });

        live = live.slice(-keepRecent);
        compacted = true;
        estimated = tokensOf(live);
      }
    }

    // Returned separately, not pushed in as a system turn: AI SDK v7 rejects
    // role: "system" inside messages and wants the instructions option.
    const modelMessages: ModelMessage[] = [];
    for (const message of live) {
      const converted = toModelMessage(message);
      if (converted) modelMessages.push(converted);
    }

    return {
      modelMessages,
      summary,
      recentTurns: live.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
        agentType: m.agentType,
      })),
      lastAgentType: [...live].reverse().find((m) => m.agentType)?.agentType ?? null,
      stats: {
        totalMessages: allMessages.length,
        messagesInWindow: live.length,
        summarisedMessages: summarisedCount,
        estimatedTokens: estimated,
        compacted,
      },
    };
  },
};
