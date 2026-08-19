import type { ReactNode } from "react";
import type { SupportUIMessage } from "@repo/api";
import type { AgentType } from "@repo/shared";
import { themeFor } from "./agent-theme.js";
import { CompactionNotice, RoutingCard, ToolChip } from "./Activity.js";

// A markdown library is 40kB to render short prose and the odd bullet list.
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={key++} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1.5 space-y-1 pl-1">
        {bullets.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted">•</span>
            <span>{inline(item)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet?.[1]) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim().length === 0) continue;
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-1 first:mt-0 last:mb-0">
        {inline(line)}
      </p>,
    );
  }
  flush();

  return <div className="leading-relaxed">{blocks}</div>;
}

export function AgentBadge({ agent }: { agent: AgentType }) {
  const theme = themeFor(agent);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${theme.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
      {theme.label}
    </span>
  );
}

export function MessageRow({ message }: { message: SupportUIMessage }) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");

    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-line bg-surface-2 px-4 py-2.5 text-[15px] text-ink">
          <RichText text={text} />
        </div>
      </div>
    );
  }

  // The routing decision determines the badge, so it is read from the stream
  // parts rather than tracked in separate component state.
  const routePart = message.parts.find((p) => p.type === "data-route");
  const agent: AgentType = routePart?.data.agent ?? "support";
  const theme = themeFor(agent);

  return (
    <div className="flex gap-3">
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${theme.ring} bg-surface text-[11px] font-semibold ${theme.text}`}
      >
        {theme.short.slice(0, 2).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5">
          <AgentBadge agent={agent} />
        </div>

        {/* Parts are rendered in arrival order, which is also causal order:
            the routing decision, then each tool as it ran, then the answer. */}
        {message.parts.map((part, index) => {
          switch (part.type) {
            case "data-route":
              return <RoutingCard key={`route-${index}`} route={part.data} />;
            case "data-context":
              return <CompactionNotice key={`ctx-${index}`} context={part.data} />;
            case "data-tool":
              return (
                <div key={`tool-${index}`} className="mb-1.5">
                  <ToolChip tool={part.data} />
                </div>
              );
            case "text":
              return part.text.trim().length > 0 ? (
                <div
                  key={`text-${index}`}
                  className="mt-1 max-w-[75ch] text-[15px] text-ink/90"
                >
                  <RichText text={part.text} />
                </div>
              ) : null;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
