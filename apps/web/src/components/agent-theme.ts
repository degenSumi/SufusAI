import type { AgentType } from "@repo/shared";

// Full class strings: Tailwind scans source text, so bg-${x} produces nothing.
export interface AgentTheme {
  label: string;
  short: string;
  dot: string;
  chip: string;
  ring: string;
  text: string;
}

export const AGENT_THEME: Record<AgentType, AgentTheme> = {
  support: {
    label: "Support Agent",
    short: "Support",
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    ring: "ring-emerald-500/30",
    text: "text-emerald-300",
  },
  order: {
    label: "Order Agent",
    short: "Order",
    dot: "bg-sky-400",
    chip: "bg-sky-500/10 text-sky-300 border-sky-500/25",
    ring: "ring-sky-500/30",
    text: "text-sky-300",
  },
  billing: {
    label: "Billing Agent",
    short: "Billing",
    dot: "bg-violet-400",
    chip: "bg-violet-500/10 text-violet-300 border-violet-500/25",
    ring: "ring-violet-500/30",
    text: "text-violet-300",
  },
};

export function themeFor(agent: AgentType | null | undefined): AgentTheme {
  return AGENT_THEME[agent ?? "support"];
}
