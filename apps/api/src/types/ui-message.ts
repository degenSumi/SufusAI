import type { UIMessage } from "ai";
import type { SupportDataParts, SupportMessageMetadata } from "@repo/shared";

// Shared with the web app so onData and message.parts are exhaustively typed.
export type SupportUIMessage = UIMessage<SupportMessageMetadata, SupportDataParts>;
