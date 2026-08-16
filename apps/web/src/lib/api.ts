import { hc } from "hono/client";
import type { AppType } from "@repo/api";

export const API_URL = import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

// Types come from the API workspace package. No codegen, no OpenAPI document.
export const api = hc<AppType>(API_URL);

/** The streaming endpoint is driven by `useChat`, which needs the raw URL. */
export const CHAT_ENDPOINT = `${API_URL}/api/chat/messages`;

export type ConversationSummaryResponse = Awaited<
  ReturnType<Awaited<ReturnType<typeof api.api.chat.conversations.$get>>["json"]>
>;

export type ConversationDetailResponse = Awaited<
  ReturnType<Awaited<ReturnType<(typeof api.api.chat.conversations)[":id"]["$get"]>>["json"]>
>;

export type AgentListResponse = Awaited<
  ReturnType<Awaited<ReturnType<typeof api.api.agents.$get>>["json"]>
>;
