import type { ConversationSummary } from "@repo/shared";
import { themeFor } from "./agent-theme.js";
import { Pitch } from "./Pitch.js";
import { Logo } from "./Logo.js";

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
    <aside className="flex h-full w-full flex-col border-r border-line bg-surface md:w-72 md:shrink-0">
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="glow-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-hi to-brand text-white">
            <Logo className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-semibold tracking-tight">Sufus</h1>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-brand-soft">
              Support As A Service
            </p>
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
                    className={`group flex items-start gap-2 rounded-lg px-2.5 py-2.5 transition-colors md:py-2 ${
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
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-xs text-muted transition-opacity hover:bg-rose-500/15 hover:text-rose-300 focus:opacity-100 active:bg-rose-500/15 md:h-auto md:w-auto md:px-1.5 md:py-0.5 md:opacity-0 md:group-hover:opacity-100"
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

      <div className="border-t border-line px-3 py-3">
        <Pitch />
      </div>
    </aside>
  );
}
