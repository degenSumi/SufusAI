import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SupportUIMessage } from "@repo/api";
import type { ConversationSummary } from "@repo/shared";
import { api, CHAT_ENDPOINT } from "./lib/api.js";
import { toUIMessages } from "./lib/messages.js";
import { Sidebar } from "./components/Sidebar.js";
import { MessageRow } from "./components/Message.js";
import { StatusPill } from "./components/Activity.js";

const SUGGESTIONS = [
  "Where is my order ORD-1023?",
  "I think I was charged twice",
  "How long do I have to return something?",
  "Can you cancel ORD-1024?",
];

export default function App() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [input, setInput] = useState("");

  // The transport closure is created once, so it would otherwise capture the
  // conversation id from first render forever. A ref keeps it current.
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    const response = await api.api.chat.conversations.$get({ query: {} });
    if (!response.ok) return;
    const data = await response.json();
    setConversations(data.conversations as ConversationSummary[]);
  }, []);

  const { messages, sendMessage, setMessages, status, error, stop } = useChat<SupportUIMessage>({
    transport: new DefaultChatTransport({
      api: CHAT_ENDPOINT,
      // The server owns history — context assembly and compaction read from the DB.
      prepareSendMessagesRequest: ({ messages: outgoing }) => {
        const last = outgoing.at(-1);
        const text =
          last?.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("") ?? "";

        return {
          body: {
            ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
            message: text,
          },
        };
      },
    }),

    onData: (part) => {
      // Transient status parts exist only here — they never reach message.parts.
      if (part.type === "data-status") {
        setStatusLabel(part.data.label);
      }
      // A brand-new thread learns its id from the first part of the stream.
      if (part.type === "data-conversation") {
        setConversationId(part.data.id);
        conversationIdRef.current = part.data.id;
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Clear the "working" pill and resync the sidebar once a turn settles.
  useEffect(() => {
    if (busy) return;
    setStatusLabel(null);
    void refreshConversations();
  }, [busy, refreshConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, statusLabel]);

  const openConversation = useCallback(
    async (id: string) => {
      if (busy) stop();
      const response = await api.api.chat.conversations[":id"].$get({ param: { id } });
      if (!response.ok) return;
      const data = await response.json();
      setConversationId(id);
      conversationIdRef.current = id;
      setMessages(toUIMessages(data.messages as Parameters<typeof toUIMessages>[0]));
    },
    [busy, stop, setMessages],
  );

  const startNew = useCallback(() => {
    if (busy) stop();
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
  }, [busy, stop, setMessages]);

  const removeConversation = useCallback(
    async (id: string) => {
      await api.api.chat.conversations[":id"].$delete({ param: { id } });
      if (conversationIdRef.current === id) startNew();
      void refreshConversations();
    },
    [startNew, refreshConversations],
  );

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || busy) return;
      setInput("");
      void sendMessage({ text: trimmed });
    },
    [busy, sendMessage],
  );

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  return (
    <div className="flex h-full">
      <Sidebar
        conversations={conversations}
        activeId={conversationId}
        busy={busy}
        onSelect={openConversation}
        onNew={startNew}
        onDelete={removeConversation}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            {messages.length === 0 ? (
              <EmptyState onPick={submit} disabled={busy} />
            ) : (
              <div className="space-y-6">
                {messages.map((message) => (
                  <MessageRow key={message.id} message={message} />
                ))}
              </div>
            )}

            {statusLabel && (
              <div className="mt-5 pl-10">
                <StatusPill label={statusLabel} />
              </div>
            )}

            {error && (
              <div className="mt-5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
                {error.message}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-line bg-surface/60 px-6 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="mx-auto flex max-w-3xl gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about an order, a charge, or anything else…"
              className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-[15px] outline-none placeholder:text-muted/70 focus:border-sky-500/40"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-xl border border-line bg-surface-2 px-5 text-sm font-medium hover:bg-line"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim().length === 0}
                className="rounded-xl bg-sky-600 px-5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-30"
              >
                Send
              </button>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="pt-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-xl text-sky-300">
        ◆
      </div>
      <h2 className="text-lg font-semibold">How can we help, Alex?</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
        A router agent reads your message and hands it to the right specialist — Support, Order or
        Billing. You will see which one it picked and why.
      </p>

      <div className="mx-auto mt-7 grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => onPick(suggestion)}
            className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[13px] text-ink/80 transition-colors hover:border-sky-500/30 hover:bg-surface-2 disabled:opacity-40"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
