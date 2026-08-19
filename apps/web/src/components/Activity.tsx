import { useState } from "react";
import type { ContextData, RouteData, ToolData } from "@repo/shared";
import { themeFor } from "./agent-theme.js";

// Label is whatever the server last reported, so it describes real work.
export function StatusPill({ label }: { label: string }) {
  return (
    <div className="fade-up flex items-center gap-2.5 rounded-full border border-line bg-surface-2 px-3.5 py-2 text-sm text-muted">
      <span className="flex gap-1">
        <span className="dot h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-brand" />
      </span>
      {label}
    </div>
  );
}

// Makes the classification visible, and is the fastest way to spot a routing bug.
export function RoutingCard({ route }: { route: RouteData }) {
  const [open, setOpen] = useState(false);
  const theme = themeFor(route.agent);
  const confidence = Math.round(route.confidence * 100);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`} />
        <span className="text-muted">Routed to</span>
        <span className={`font-medium ${theme.text}`}>{route.agentName}</span>

        {route.isFallback ? (
          <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            fallback
          </span>
        ) : (
          <span className="text-muted">{confidence}%</span>
        )}

        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted">
          <span className="rounded bg-surface-2 px-1.5 py-0.5">{route.source}</span>
          <span>{route.latencyMs}ms</span>
          <span className="transition-transform group-hover:text-ink">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="fade-up mt-1 space-y-1.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs">
          <Row label="Reasoning" value={route.reasoning} />
          <Row label="Intent" value={route.intent} />
          <Row label="Confidence" value={`${confidence}%`} />
          <Row
            label="Decided by"
            value={
              route.source === "heuristic"
                ? "Deterministic rule — no model call"
                : route.source === "fallback"
                  ? "Fallback — confidence below threshold"
                  : "LLM classifier with conversation context"
            }
          />
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span className="text-ink/90">{value}</span>
    </div>
  );
}

/** One tool execution. Flips from running to done in place. */
export function ToolChip({ tool }: { tool: ToolData }) {
  const running = tool.status === "running";
  const errored = tool.status === "error";

  return (
    <div
      className={`fade-up flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
        errored
          ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
          : running
            ? "border-brand/25 bg-brand/10 text-brand-soft"
            : "border-line bg-surface text-muted"
      }`}
    >
      {running ? (
        <span className="flex gap-0.5">
          <span className="dot h-1 w-1 rounded-full bg-brand-soft" />
          <span className="dot h-1 w-1 rounded-full bg-brand-soft" />
          <span className="dot h-1 w-1 rounded-full bg-brand-soft" />
        </span>
      ) : (
        <span className={errored ? "text-rose-300" : "text-emerald-400"}>{errored ? "✕" : "✓"}</span>
      )}

      <span className={running ? "text-brand-soft" : ""}>{tool.label}</span>

      {tool.summary && <span className="text-muted/70">· {tool.summary}</span>}
      {tool.durationMs !== undefined && !running && (
        <span className="ml-auto pl-2 text-[10px] text-muted/60">{tool.durationMs}ms</span>
      )}
    </div>
  );
}

/** Shown only on turns where the context window was actually compacted. */
export function CompactionNotice({ context }: { context: ContextData }) {
  if (!context.compacted) return null;
  return (
    <div className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200/80">
      Context compacted — {context.summarisedMessages} earlier messages summarised to stay inside
      the token budget ({context.messagesInWindow} kept verbatim).
    </div>
  );
}
