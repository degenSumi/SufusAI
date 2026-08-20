import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type ModelMessage,
} from "ai";
import type { AgentType } from "@repo/shared";
import { routeMessage } from "../agents/router.agent.js";
import { createSubAgent } from "../agents/subagents.js";
import { getAgentDefinition } from "../agents/registry.js";
import {
  labelForToolCall,
  summariseToolOutput,
} from "../agents/tools/labels.js";
import { contextService } from "./context.service.js";
import { conversationService } from "./conversation.service.js";
import { normaliseProviderError } from "../lib/errors.js";
import type { SupportUIMessage } from "../types/ui-message.js";

export interface ChatRequest {
  userId: string;
  conversationId?: string;
  message: string;
}

interface ToolRecord {
  toolName: string;
  label: string;
  status: "running" | "done" | "error";
  summary?: string;
  durationMs?: number;
}

// This turn only — the next message may well be classifiable.
const CLARIFY_DIRECTIVE = `THIS TURN ONLY: the routing layer could not confidently classify the customer's message. Do not guess what they want.

If it is a greeting or carries no request at all, this is the opening of the demo and you introduce it — no clarifying question. Cover, briefly and in this order: that they are talking to Sufus, agentic support as a service, where a router picks the right specialist for every message; that the account in front of you is demo data for Voltway, a fictional electronics retailer, so they can try the flows for real; two concrete things worth asking, drawn from what this account actually has; and one closing line offering the same built for their own business. Six sentences at most, and no markdown heading.

Otherwise ask ONE short clarifying question offering concrete options based on what this account actually has (orders, invoices, a subscription). Keep that to two sentences.`;

const summaryDirective = (summary: string) =>
  `Notes from earlier in this conversation, for context:\n${summary}`;

export const orchestrator = {
  // route -> delegate -> stream -> persist.
  async handleMessage(request: ChatRequest): Promise<Response> {
    const { userId, message } = request;

    // Everything before the stream opens is allowed to fail loudly — the error
    // middleware can still produce a clean JSON response at this point. Once
    // headers are sent, failures have to travel as stream parts instead.
    const { conversation, isNew } = await conversationService.resolveForMessage(
      userId,
      request.conversationId,
      message,
    );

    await conversationService.recordUserMessage(conversation.id, message);
    const context = await contextService.build(conversation.id);

    // Accumulated by the tool lifecycle callbacks, then persisted with the
    // assistant message so the tool chips survive a page reload.
    const toolRecords = new Map<string, ToolRecord>();

    const stream = createUIMessageStream<SupportUIMessage>({
      onError: (error) => normaliseProviderError(error).message,

      execute: async ({ writer }) => {
        // First part on the wire. A brand-new thread has no id client-side
        // until this arrives, and the sidebar keys off it.
        writer.write({
          type: "data-conversation",
          id: "conversation",
          data: { id: conversation.id, title: conversation.title, isNew },
        });

        writer.write({
          type: "data-status",
          data: { phase: "routing", label: "Analysing your request" },
          transient: true,
        });

        try {
          const decision = await routeMessage({
            message,
            summary: context.summary,
            recentTurns: context.recentTurns,
            lastAgentType: context.lastAgentType,
          });

          const definition = getAgentDefinition(decision.agent);

          // Persisted, not transient: the reasoning card has to survive a reload,
          // and routing decisions are worth auditing after the fact.
          writer.write({
            type: "data-route",
            id: "route",
            data: {
              agent: decision.agent,
              agentName: definition.name,
              intent: decision.intent,
              confidence: decision.confidence,
              reasoning: decision.reasoning,
              source: decision.source,
              isFallback: decision.isFallback,
              latencyMs: decision.latencyMs,
            },
          });

          if (context.stats.compacted) {
            writer.write({
              type: "data-context",
              id: "context",
              data: {
                messagesInWindow: context.stats.messagesInWindow,
                compacted: true,
                summarisedMessages: context.stats.summarisedMessages,
                estimatedTokens: context.stats.estimatedTokens,
              },
            });
          }

          writer.write({
            type: "data-status",
            data: {
              phase: "delegating",
              label: `Bringing in the ${definition.name}`,
            },
            transient: true,
          });

          const extraInstructions: string[] = [];
          if (context.summary)
            extraInstructions.push(summaryDirective(context.summary));
          if (decision.isFallback) extraInstructions.push(CLARIFY_DIRECTIVE);

          const agent = createSubAgent(
            decision.agent,
            { userId, conversationId: conversation.id },
            extraInstructions,
          );

          const messages: ModelMessage[] = context.modelMessages;

          const result = await agent.stream({
            messages,

            onStepStart: () => {
              writer.write({
                type: "data-status",
                data: { phase: "thinking", label: "Working through it" },
                transient: true,
              });
            },

            // Tool activity is reported from the real lifecycle hooks, so the
            // label the customer sees is derived from the actual call and its
            // actual arguments — never a guess or a timer.
            onToolExecutionStart: ({ toolCall }) => {
              const label = labelForToolCall(toolCall.toolName, toolCall.input);
              toolRecords.set(toolCall.toolCallId, {
                toolName: toolCall.toolName,
                label,
                status: "running",
              });
              writer.write({
                type: "data-tool",
                id: toolCall.toolCallId,
                data: { toolName: toolCall.toolName, label, status: "running" },
              });
            },

            onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }) => {
              const record = toolRecords.get(toolCall.toolCallId);
              const label =
                record?.label ??
                labelForToolCall(toolCall.toolName, toolCall.input);
              const errored = toolOutput.type === "tool-error";
              const summary = errored
                ? "Lookup failed"
                : summariseToolOutput(toolCall.toolName, toolOutput.output);

              const updated: ToolRecord = {
                toolName: toolCall.toolName,
                label,
                status: errored ? "error" : "done",
                summary,
                durationMs: Math.round(toolExecutionMs),
              };
              toolRecords.set(toolCall.toolCallId, updated);

              // Same id as the "running" write, so the client reconciles it in
              // place instead of appending a second chip.
              writer.write({
                type: "data-tool",
                id: toolCall.toolCallId,
                data: updated,
              });
            },
          });

          // The routing card is written before the agent streams, so the client has already
          // opened a message. A second start chunk renders the turn as two bubbles.
          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              sendStart: false,
              // Provider failures surface while this stream drains, after agent.stream()
              // returned, so the try/catch below never sees them.
              onError: (error) => normaliseProviderError(error).message,
            }),
          );

          // Persist here rather than in the stream's onEnd: that fires as the response
          // closes and races the client disconnect, which dropped replies and saved one
          // after the following turn's user message.
          const [finalText, finalUsage] = await Promise.all([
            result.text,
            result.totalUsage,
          ]);

          const trimmed = finalText.trim();
          if (trimmed.length > 0) {
            await conversationService.recordAssistantMessage({
              conversationId: conversation.id,
              content: trimmed,
              agentType: decision.agent,
              intent: decision.intent,
              routeSource: decision.source,
              routeConfidence: decision.confidence,
              routeReasoning: decision.reasoning,
              toolCalls: [...toolRecords.values()],
              promptTokens: finalUsage.inputTokens,
              completionTokens: finalUsage.outputTokens,
              totalTokens: finalUsage.totalTokens,
            });
          }
        } catch (error) {
          // Headers are already sent, so failures travel as a stream part.
          const normalised = normaliseProviderError(error);
          console.error(
            `[orchestrator] ${normalised.code}: ${normalised.message}`,
            error,
          );
          writer.write({
            type: "data-error",
            data: { code: normalised.code, message: normalised.message },
            transient: true,
          });
        }
      },

    });

    return createUIMessageStreamResponse({
      stream,
      // The client needs the conversation id for the very first message of a
      // new thread, and it must arrive before the body — it is what the
      // sidebar and every subsequent request key off.
      headers: { "X-Conversation-Id": conversation.id },
    });
  },
};
