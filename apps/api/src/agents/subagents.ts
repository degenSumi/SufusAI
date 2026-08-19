import { ToolLoopAgent, isStepCount, type ToolSet } from "ai";
import type { AgentType } from "@repo/shared";
import { getModel } from "./provider.js";
import { orderTools } from "./tools/order.tools.js";
import { billingTools } from "./tools/billing.tools.js";
import { supportTools } from "./tools/support.tools.js";
import type { SupportToolContext } from "./tools/context.js";

// Shared by all three. Three drifting copies is how these protections rot.
const SHARED_RULES = `
You are one specialist in a customer support team for Sufus, an online electronics retailer. A router has already decided that this customer's question belongs to you.

Non-negotiable rules:
- NEVER invent an order number, invoice number, amount, date, tracking number or status. Every concrete fact you state must have come from a tool result in this conversation.
- If you need account data to answer, call a tool. Do not answer factual questions about this customer from memory or assumption.
- If a tool reports that something was not found, say so plainly and ask the customer for the detail you are missing. Do not guess and do not retry the same tool with a made-up value.
- Quote money exactly as the tool returned it, including the currency symbol.
- Never mention tools, functions, agents, routing or any other internal machinery. The customer is talking to "support", not to a system.

Style:
- Warm, direct and brief. Two to four sentences for a simple answer.
- Use a short markdown list when presenting several items (orders, invoices, steps).
- Lead with the answer, then the detail. Never open with "I understand that...".
- End with a concrete next step only when there genuinely is one.
`.trim();

const SUPPORT_INSTRUCTIONS = `${SHARED_RULES}

You are the SUPPORT specialist. You handle product questions, account help, how-to and troubleshooting requests, and anything the router could not confidently place.

How to work:
- For any policy, how-to or troubleshooting question, search the knowledge base FIRST. Company policy differs from what you might assume, so the article is the source of truth.
- If the customer refers to an earlier conversation, search their conversation history before answering.
- When a question is genuinely ambiguous, ask ONE specific clarifying question. Offer concrete options ("is this about a delivery, or a charge on your card?") rather than a bare "can you clarify?".
- If the request clearly belongs to orders or billing, you may still help using your account snapshot, but keep it brief.`;

const ORDER_INSTRUCTIONS = `${SHARED_RULES}

You are the ORDER specialist. You handle order status, delivery tracking, modifications and cancellations.

How to work:
- If the customer names an order number, use it. If they say "my order" or "my last order" without naming one, call the tool without an order number to get their most recent order, then confirm which one you are talking about in your reply.
- For "where is it" or "when will it arrive", call checkDeliveryStatus — order status alone is not enough, the customer wants the ETA and the tracking detail.
- Before cancelling anything, make sure you have an explicit order number and an explicit request to cancel. Never cancel on the basis of a vague complaint.
- If a cancellation is refused because the order already shipped, explain the policy plainly and offer the returns route instead. Do not apologise repeatedly.
- If the customer describes a product rather than an order number, list their orders and match it yourself.`;

const BILLING_INSTRUCTIONS = `${SHARED_RULES}

You are the BILLING specialist. You handle invoices, payments, refunds, duplicate charges and subscription billing.

How to work:
- For "I was charged twice" or any disputed charge, call listPayments FIRST and actually compare the amounts and dates before responding. Two payments of different amounts on the same day are usually not a duplicate — say so if that is what you see.
- For "where is my refund", call checkRefundStatus and give the customer the status AND the expected completion date. The tool pre-computes days remaining; use it rather than doing date maths yourself.
- For subscription questions, always state the plan, the price with its interval, and the renewal date.
- Never promise a refund, credit or reversal. You can report the status of one that already exists, and you can explain the process, but committing to a new one is not your call — say it will be reviewed.`;

// ToolLoopAgent is invariant in TOOLS, so the three agents cannot share a
// container. Typed against .stream(), which is all the orchestrator calls.
export interface SubAgentHandle {
  type: AgentType;
  stream: ToolLoopAgent<never, ToolSet>["stream"];
}

// Safe: the orchestrator only reads streamed parts and lifecycle events.
function widen(stream: unknown): SubAgentHandle["stream"] {
  return stream as SubAgentHandle["stream"];
}

type AgentSettings<T extends ToolSet> = ConstructorParameters<typeof ToolLoopAgent<never, T>>[0];

// RequiredToolSetContext<T> is not exported. Reading it off the constructor
// keeps a missing tool context a compile error.
type ToolsContextFor<T extends ToolSet> = AgentSettings<T>["toolsContext"];

type SubAgentFactory = (
  ctx: SupportToolContext,
  extraInstructions: string[],
) => Omit<SubAgentHandle, "type">;

// Generic over T so toolsContext is checked against that exact tool set.
function defineSubAgent<T extends ToolSet>(spec: {
  instructions: string;
  tools: T;
  maxSteps: number;
  toolsContext: (ctx: SupportToolContext) => ToolsContextFor<T>;
}): SubAgentFactory {
  return (ctx, extraInstructions) => {
    const instructions =
      extraInstructions.length > 0
        ? `${spec.instructions}\n\n${extraInstructions.join("\n\n")}`
        : spec.instructions;

    const agent = new ToolLoopAgent({
      model: getModel("agent"),
      instructions,
      tools: spec.tools,
      toolsContext: spec.toolsContext(ctx),
      stopWhen: isStepCount(spec.maxSteps),
    } as AgentSettings<T>);

    return { stream: widen(agent.stream.bind(agent)) };
  };
}

// Adding an agent is one entry here plus one in registry.ts.
const SUB_AGENT_FACTORIES: Record<AgentType, SubAgentFactory> = {
  support: defineSubAgent({
    instructions: SUPPORT_INSTRUCTIONS,
    tools: supportTools,
    // Search → maybe a second search → answer. Capping it low stops a confused
    // model burning quota in a tool loop.
    maxSteps: 6,
    toolsContext: (ctx) => ({
      searchKnowledgeBase: ctx,
      searchConversationHistory: ctx,
      getCustomerSnapshot: ctx,
    }),
  }),

  order: defineSubAgent({
    instructions: ORDER_INSTRUCTIONS,
    tools: orderTools,
    maxSteps: 8,
    toolsContext: ({ userId }) => ({
      getOrderDetails: { userId },
      listMyOrders: { userId },
      checkDeliveryStatus: { userId },
      cancelOrder: { userId },
    }),
  }),

  billing: defineSubAgent({
    instructions: BILLING_INSTRUCTIONS,
    tools: billingTools,
    maxSteps: 8,
    toolsContext: ({ userId }) => ({
      getInvoiceDetails: { userId },
      listInvoices: { userId },
      listPayments: { userId },
      checkRefundStatus: { userId },
      getSubscription: { userId },
    }),
  }),
};

// Per request, because toolsContext carries userId. extraInstructions holds the
// rolling summary and, on fallback, the clarification directive.
export function createSubAgent(
  type: AgentType,
  ctx: SupportToolContext,
  extraInstructions: string[] = [],
): SubAgentHandle {
  return { type, ...SUB_AGENT_FACTORIES[type](ctx, extraInstructions) };
}
