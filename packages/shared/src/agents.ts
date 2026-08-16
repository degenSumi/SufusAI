import { z } from "zod";

// support doubles as the fallback: the only remit open-ended enough to ask a
// clarifying question instead of guessing.
export const AGENT_TYPES = ["support", "order", "billing"] as const;
export const agentTypeSchema = z.enum(AGENT_TYPES);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const FALLBACK_AGENT: AgentType = "support";

// A closed enum keeps structured output reliable on small models. unknown is a
// first-class outcome, not an error.
export const INTENTS = [
  "order_status",
  "order_tracking",
  "order_modify",
  "order_cancel",
  "billing_invoice",
  "billing_refund",
  "billing_payment",
  "billing_subscription",
  "support_faq",
  "support_troubleshoot",
  "support_account",
  "unknown",
] as const;
export const intentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof intentSchema>;

/** Which routing tier produced the decision. Surfaced in the UI and logs. */
export const ROUTE_SOURCES = ["heuristic", "llm", "fallback", "sticky"] as const;
export const routeSourceSchema = z.enum(ROUTE_SOURCES);
export type RouteSource = z.infer<typeof routeSourceSchema>;

/**
 * What the LLM classifier is asked to produce. Kept to four scalar fields —
 * anything richer degrades structured-output reliability on flash-class models.
 */
export const routerOutputSchema = z.object({
  agent: agentTypeSchema,
  intent: intentSchema,
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How certain you are, 0-1. Below 0.5 means you are guessing."),
  reasoning: z
    .string()
    .max(240)
    .describe("One sentence explaining the choice, addressed to an engineer."),
});
export type RouterOutput = z.infer<typeof routerOutputSchema>;

/** The router's decision after heuristics, the LLM and fallback logic. */
export const routeDecisionSchema = routerOutputSchema.extend({
  source: routeSourceSchema,
  isFallback: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
});
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

/** Below this the router refuses to commit and hands off for clarification. */
export const CONFIDENCE_THRESHOLD = 0.5;

export interface AgentCapability {
  name: string;
  description: string;
}

export interface AgentDefinition {
  type: AgentType;
  name: string;
  description: string;
  /** Intents this agent is the canonical destination for. */
  handles: Intent[];
  capabilities: AgentCapability[];
  /** Tool names exposed to this agent, for the capabilities endpoint. */
  tools: AgentCapability[];
  /** Colour token the frontend uses for this agent's badge. */
  accent: string;
}
