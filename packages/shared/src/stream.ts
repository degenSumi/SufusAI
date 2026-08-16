import type { AgentType, Intent, RouteSource } from "./agents.js";

// Custom parts emitted alongside the tokens. The data- prefix is wire format.

/** Transient — a live "what is happening right now" label. Not persisted. */
export interface StatusData {
  phase: "routing" | "delegating" | "thinking" | "responding";
  label: string;
}

/** Persisted — the router's decision, rendered as an expandable card. */
export interface RouteData {
  agent: AgentType;
  agentName: string;
  intent: Intent;
  confidence: number;
  reasoning: string;
  source: RouteSource;
  isFallback: boolean;
  latencyMs: number;
}

// Written twice with the same id: running, then done. Same id updates in place.
export interface ToolData {
  toolName: string;
  label: string;
  status: "running" | "done" | "error";
  summary?: string;
  durationMs?: number;
}

/** Persisted — surfaced when context compaction ran for this turn. */
export interface ContextData {
  messagesInWindow: number;
  compacted: boolean;
  summarisedMessages: number;
  estimatedTokens: number;
}

/** Transient — a failure that happened mid-stream, after headers were sent. */
export interface ErrorData {
  code: string;
  message: string;
}

// First part on the wire — a new thread learns its id from this.
export interface ConversationData {
  id: string;
  title: string;
  isNew: boolean;
}

// Type alias, not interface: the SDK constrains this to Record<string, unknown>
// and only aliases get an implicit index signature.
export type SupportDataParts = {
  conversation: ConversationData;
  status: StatusData;
  route: RouteData;
  tool: ToolData;
  context: ContextData;
  error: ErrorData;
};

/** Metadata attached to a persisted assistant message. */
export interface SupportMessageMetadata {
  agentType?: AgentType;
  agentName?: string;
  createdAt?: string;
  totalTokens?: number;
}
