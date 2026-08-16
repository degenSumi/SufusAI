import type { SupportUIMessage } from "@repo/api";
import type { ChatMessage } from "@repo/shared";

// A reload has to look like the live stream did, so the routing card and tool
// chips are rebuilt from the persisted columns.
export function toUIMessages(messages: ChatMessage[]): SupportUIMessage[] {
  return messages.map((message): SupportUIMessage => {
    if (message.role === "user") {
      return {
        id: message.id,
        role: "user",
        parts: [{ type: "text", text: message.content }],
      };
    }

    const parts: SupportUIMessage["parts"] = [];

    if (message.agentType && message.routeReasoning) {
      parts.push({
        type: "data-route",
        id: "route",
        data: {
          agent: message.agentType,
          agentName:
            message.agentType.charAt(0).toUpperCase() + message.agentType.slice(1) + " Agent",
          intent: message.intent ?? "unknown",
          confidence: message.routeConfidence ?? 0,
          reasoning: message.routeReasoning,
          source: message.routeSource ?? "llm",
          isFallback: message.routeSource === "fallback",
          latencyMs: 0,
        },
      });
    }

    for (const [index, call] of (message.toolCalls ?? []).entries()) {
      parts.push({
        type: "data-tool",
        id: `${message.id}-tool-${index}`,
        data: {
          toolName: call.toolName,
          label: call.label,
          status: call.status === "error" ? "error" : "done",
          summary: call.summary,
          durationMs: call.durationMs,
        },
      });
    }

    parts.push({ type: "text", text: message.content });

    return {
      id: message.id,
      role: "assistant",
      parts,
      metadata: {
        agentType: message.agentType ?? undefined,
        createdAt: message.createdAt,
        totalTokens: message.totalTokens ?? undefined,
      },
    };
  });
}
