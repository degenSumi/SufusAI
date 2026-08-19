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
import { Logo } from "./components/Logo.js";

const AGENT_LEGEND = [
  { label: "Support", dot: "bg-emerald-400", chip: "border-emerald-500/25 text-emerald-300" },
  { label: "Order", dot: "bg-sky-400", chip: "border-sky-500/25 text-sky-300" },
  { label: "Billing", dot: "bg-violet-400", chip: "border-violet-500/25 text-violet-300" },
];

const SUGGESTIONS = [
  "Where is my order ORD-1023?",
  "I think I was charged twice",
  "What is the return policy?",
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

  // Loaded threads are kept so re-opening one is instant instead of a round trip.
  const messageCacheRef = useRef(new Map<string, SupportUIMessage[]>());
  const [loadingThread, setLoadingThread] = useState(false);

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
  const activeTitle =
    conversations.find((conversation) => conversation.id === conversationId)?.title ??
    "New conversation";

  // Clear the "working" pill and resync the sidebar once a turn settles.
  useEffect(() => {
    if (busy) return;
    setStatusLabel(null);
    if (conversationIdRef.current) messageCacheRef.current.delete(conversationIdRef.current);
    void refreshConversations();
  }, [busy, refreshConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, statusLabel]);

  const openConversation = useCallback(
    async (id: string) => {
      if (busy) stop();

      // Select first, fetch second — the sidebar and header react immediately
      // rather than after the network settles.
      setConversationId(id);
      conversationIdRef.current = id;

      const cached = messageCacheRef.current.get(id);
      if (cached) {
        setMessages(cached);
        setLoadingThread(false);
        return;
      }

      setMessages([]);
      setLoadingThread(true);
      try {
        const response = await api.api.chat.conversations[":id"].$get({ param: { id } });
        if (!response.ok) return;
        const data = await response.json();
        const loaded = toUIMessages(data.messages as Parameters<typeof toUIMessages>[0]);
        messageCacheRef.current.set(id, loaded);
        // A newer click may have landed while this was in flight.
        if (conversationIdRef.current === id) setMessages(loaded);
      } finally {
        // A slower request for a thread the user has already navigated away from
        // must not clear the spinner belonging to the newer one.
        if (conversationIdRef.current === id) setLoadingThread(false);
      }
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
      messageCacheRef.current.delete(id);
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

      <main className="ambient relative flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-line/70 px-6 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Logo className="h-4 w-4 text-brand" />
            <span className="text-ink/80">Sufus</span>
            <span className="text-line">/</span>
            <span className="truncate">{activeTitle}</span>
          </div>
          <div className="flex items-center gap-3">
            {AGENT_LEGEND.map(({ label, dot }) => (
              <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                {label}
              </span>
            ))}
          </div>
        </header>

        <div ref={scrollRef} className="grid-fade scroll-thin relative flex-1 overflow-y-auto">
          <div
            className={`relative z-10 mx-auto w-full max-w-3xl px-6 ${
              messages.length === 0 && !loadingThread ? "flex min-h-full items-center py-10" : "py-8"
            }`}
          >
            {loadingThread ? (
              <ThreadSkeleton />
            ) : messages.length === 0 ? (
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

        <div className="relative z-10 border-t border-line/70 px-6 pb-5 pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-line bg-surface/80 p-1.5 pl-4 shadow-lg shadow-black/30 backdrop-blur transition-colors focus-within:border-brand/45"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about an order, a charge, or anything else…"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none placeholder:text-muted/70"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="shrink-0 rounded-xl border border-line bg-surface-2 px-5 py-2.5 text-sm font-medium hover:bg-line"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim().length === 0}
                className="shrink-0 rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-brand-hi disabled:opacity-25 disabled:shadow-none"
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

function ThreadSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1, 2].map((row) => (
        <div key={row} className={row % 2 === 0 ? "flex justify-end" : "flex gap-3"}>
          {row % 2 === 1 && <div className="h-7 w-7 shrink-0 animate-pulse rounded-lg bg-surface-2" />}
          <div className={`space-y-2 ${row % 2 === 0 ? "w-1/3" : "w-2/3"}`}>
            <div className="h-9 animate-pulse rounded-xl bg-surface-2" />
            {row % 2 === 1 && <div className="h-16 animate-pulse rounded-xl bg-surface-2/70" />}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="flex w-full flex-col items-center text-center">
      <div className="glow-brand mb-7 flex h-20 w-20 items-center justify-center rounded-[26px] bg-gradient-to-br from-brand-hi to-brand text-white">
        <Logo className="h-11 w-11" />
      </div>

      <h1 className="text-5xl font-semibold tracking-tight">Sufus</h1>
      <p className="mt-2.5 text-[12px] font-medium uppercase tracking-[0.3em] text-brand-soft">
        Support As A Service
      </p>

      <div className="mt-6 h-px w-20 bg-gradient-to-r from-transparent via-line to-transparent" />

      <h2 className="mt-6 text-lg font-medium text-ink/90">How can we help, Alex?</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        A router agent reads your message and hands it to the right specialist. You will see which
        one it picked and why.
      </p>

      <div className="mt-5 flex items-center gap-2">
        {AGENT_LEGEND.map(({ label, chip, dot }) => (
          <span
            key={label}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${chip}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            {label}
          </span>
        ))}
      </div>

      <div className="mt-8 grid w-full max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => onPick(suggestion)}
            className="lift flex items-center rounded-xl border border-line bg-surface/70 px-4 py-3 text-left text-[13px] text-ink/80 hover:border-brand/35 hover:bg-surface-2 disabled:opacity-40 disabled:hover:transform-none"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
