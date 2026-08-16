import type { ConversationSummary } from "@repo/shared";
import { themeFor } from "./agent-theme.js";

interface SidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Sidebar({
  conversations,
  activeId,
  busy,
  onSelect,
  onNew,
  onDelete,
}: SidebarProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
            ◆
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Northwind Support</h1>
            <p className="truncate text-[11px] text-muted">Multi-agent assistant</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="mt-3.5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium transition-colors hover:bg-line disabled:opacity-40"
        >
          New conversation
        </button>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">No conversations yet.</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const theme = themeFor(conversation.lastAgentType);
              const active = conversation.id === activeId;
              return (
                <li key={conversation.id}>
                  <div
                    className={`group flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                      active ? "bg-surface-2 ring-1 ring-line" : "hover:bg-surface-2"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        {conversation.lastAgentType && (
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`} />
                        )}
                        <span className="truncate text-[13px]">{conversation.title}</span>
                      </div>
                      <div className="mt-0.5 flex gap-2 text-[10px] text-muted">
                        <span>{conversation.messageCount} messages</span>
                        <span>·</span>
                        <span>{relativeTime(conversation.updatedAt)}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                      onClick={() => onDelete(conversation.id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted opacity-0 transition-opacity hover:bg-rose-500/15 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-3 text-[10px] leading-relaxed text-muted">
        Signed in as <span className="text-ink/70">Alex Morgan</span>
        <br />
        Router → Support · Order · Billing
      </div>
    </aside>
  );
}
