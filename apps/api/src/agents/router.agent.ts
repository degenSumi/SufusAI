import { generateText, Output } from "ai";
import {
  CONFIDENCE_THRESHOLD,
  FALLBACK_AGENT,
  routerOutputSchema,
  type AgentType,
  type RouteDecision,
} from "@repo/shared";
import { getModel } from "./provider.js";
import { buildRoutingMenu } from "./registry.js";

// Routing on the message alone breaks on turn two: "when will it get here?" is
// only an order question because of what came before it.
export interface RoutingContext {
  message: string;
  /** Rolling summary of compacted history, if this conversation has any. */
  summary?: string | null;
  recentTurns: Array<{ role: string; content: string; agentType?: AgentType | null }>;
  lastAgentType?: AgentType | null;
}

/** High-precision ID patterns. */
const ORDER_ID = /\bORD-\d{4}\b/i;
const BILLING_ID = /\b(?:INV|REF)-\d{4}\b/i;

// "charged twice for ORD-1023" is billing despite carrying an order number.
const BILLING_VOCAB =
  /\b(refund|charge[sd]?|charging|invoice|bill(?:ing|ed)?|payment|paid|receipt|subscription|money back|double[- ]charged|overcharged)\b/i;

// Tier 1. Conservative on purpose: defers the moment two domains compete.
export function heuristicRoute(message: string): { agent: AgentType; reason: string } | null {
  const hasOrderId = ORDER_ID.test(message);
  const hasBillingId = BILLING_ID.test(message);
  const soundsFinancial = BILLING_VOCAB.test(message);

  if (hasBillingId && !hasOrderId) {
    return { agent: "billing", reason: "Message contains an invoice or refund number." };
  }
  if (hasOrderId && !hasBillingId && !soundsFinancial) {
    return { agent: "order", reason: "Message contains an order number and no billing language." };
  }
  return null;
}

function renderContext(ctx: RoutingContext): string {
  const parts: string[] = [];

  if (ctx.summary) {
    parts.push(`Earlier in this conversation (summarised):\n${ctx.summary}`);
  }

  if (ctx.recentTurns.length > 0) {
    const turns = ctx.recentTurns
      .slice(-6)
      .map((t) => {
        const who = t.role === "user" ? "Customer" : `Agent(${t.agentType ?? "support"})`;
        const text = t.content.length > 300 ? `${t.content.slice(0, 300)}…` : t.content;
        return `${who}: ${text}`;
      })
      .join("\n");
    parts.push(`Recent turns:\n${turns}`);
  }

  if (ctx.lastAgentType) {
    parts.push(`The previous turn was handled by the ${ctx.lastAgentType} agent.`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "This is the first message in a new conversation.";
}

const ROUTER_INSTRUCTIONS = `You are the routing layer of a customer support system for Sufus, an online electronics retailer. You do not talk to customers. You read the incoming message together with the conversation so far and decide which specialist should handle it.

Available specialists:
${buildRoutingMenu()}

How to decide:
- Read the CONVERSATION CONTEXT first, then the new message. A follow-up like "where is it?", "when will it arrive?" or "what about the other one?" carries no topic of its own — it inherits the topic of the previous turn. Route it to the agent that handled that turn.
- A message that changes the subject overrides the previous agent. "I was charged twice for it" following an order discussion is a BILLING question, even though "it" refers to an order.
- Route on what the customer WANTS, not on which nouns appear. "My laptop order is broken" is a support/troubleshooting question about a product, not an order-status question.
- Anything about money that has already moved — charges, refunds, invoices, subscriptions — is billing. Anything about goods moving — status, tracking, cancelling, changing — is order. Everything else is support.

Confidence:
- 0.9+ : the message names its domain explicitly.
- 0.7-0.9 : clear from context.
- 0.5-0.7 : a reasonable inference.
- Below 0.5 : you are guessing. Use this honestly — it triggers a clarifying question, which is a better outcome for the customer than a confident wrong answer. Greetings, gibberish and messages too vague to place belong here with intent "unknown".

Reasoning must be ONE short sentence written for an engineer reading a routing log.`;

// Tiers 2 and 3. Always returns a decision — a throwing router would take the
// whole conversation down.
export async function routeMessage(ctx: RoutingContext): Promise<RouteDecision> {
  const startedAt = Date.now();

  const fast = heuristicRoute(ctx.message);
  if (fast) {
    return {
      agent: fast.agent,
      intent: fast.agent === "billing" ? "billing_invoice" : "order_status",
      confidence: 0.95,
      reasoning: fast.reason,
      source: "heuristic",
      isFallback: false,
      latencyMs: Date.now() - startedAt,
    };
  }

  try {
    const result = await generateText({
      model: getModel("router"),
      instructions: ROUTER_INSTRUCTIONS,
      // Temperature 0: classification should be reproducible. The same message
      // in the same context must always route the same way, or the behaviour
      // is untestable.
      temperature: 0,
      output: Output.object({ schema: routerOutputSchema }),
      prompt: `CONVERSATION CONTEXT
${renderContext(ctx)}

NEW MESSAGE FROM CUSTOMER
${ctx.message}

Which specialist should handle this?`,
    });

    const decision = result.output;
    const belowThreshold = decision.confidence < CONFIDENCE_THRESHOLD;
    const unknown = decision.intent === "unknown";

    if (belowThreshold || unknown) {
      return {
        agent: FALLBACK_AGENT,
        intent: "unknown",
        confidence: decision.confidence,
        reasoning: `${decision.reasoning} Confidence too low to specialise — handing to support for clarification.`,
        source: "fallback",
        isFallback: true,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      ...decision,
      source: "llm",
      isFallback: false,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    // Classification is best-effort. If the model is unavailable or returns
    // something unparseable, degrade to the generalist rather than failing the
    // request — the customer still gets helped, just without specialisation.
    const message = error instanceof Error ? error.message : String(error);
    return {
      agent: FALLBACK_AGENT,
      intent: "unknown",
      confidence: 0,
      reasoning: `Router unavailable (${message.slice(0, 120)}); defaulting to the support generalist.`,
      source: "fallback",
      isFallback: true,
      latencyMs: Date.now() - startedAt,
    };
  }
}
