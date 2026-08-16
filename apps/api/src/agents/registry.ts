import type { AgentDefinition, AgentType } from "@repo/shared";

// Drives the /agents endpoints, the router's prompt menu, and the UI badges.
export const AGENT_REGISTRY: Record<AgentType, AgentDefinition> = {
  support: {
    type: "support",
    name: "Support Agent",
    description:
      "Handles general product questions, account help, troubleshooting and anything that does not clearly belong to another specialist. Also the fallback for ambiguous queries.",
    handles: ["support_faq", "support_troubleshoot", "support_account", "unknown"],
    accent: "emerald",
    capabilities: [
      { name: "General FAQs", description: "Answers help-centre questions from the knowledge base" },
      {
        name: "Troubleshooting",
        description: "Walks through step-by-step fixes for common product problems",
      },
      {
        name: "Conversation recall",
        description: "Looks up what was discussed in the customer's earlier conversations",
      },
      {
        name: "Clarification",
        description: "Asks a focused follow-up question when a request is ambiguous",
      },
    ],
    tools: [
      {
        name: "searchKnowledgeBase",
        description: "Keyword search across help-centre articles, ranked by relevance",
      },
      {
        name: "searchConversationHistory",
        description: "Searches the customer's past conversations for a topic",
      },
      {
        name: "getCustomerSnapshot",
        description: "Account overview: recent order count, open invoices, subscription state",
      },
    ],
  },

  order: {
    type: "order",
    name: "Order Agent",
    description:
      "Handles order status, delivery tracking, modifications and cancellations for physical orders.",
    handles: ["order_status", "order_tracking", "order_modify", "order_cancel"],
    accent: "sky",
    capabilities: [
      { name: "Order lookup", description: "Retrieves line items, totals and status for an order" },
      { name: "Delivery tracking", description: "Reports carrier, tracking number and live ETA" },
      {
        name: "Cancellation",
        description: "Cancels an order when policy allows, and explains why when it does not",
      },
    ],
    tools: [
      { name: "getOrderDetails", description: "Full detail for one order by number, or the latest" },
      { name: "listMyOrders", description: "The customer's recent orders, newest first" },
      { name: "checkDeliveryStatus", description: "Shipment status, ETA and tracking events" },
      { name: "cancelOrder", description: "Cancels an order if it has not shipped yet" },
    ],
  },

  billing: {
    type: "billing",
    name: "Billing Agent",
    description:
      "Handles invoices, payments, refunds, double charges and subscription billing questions.",
    handles: ["billing_invoice", "billing_refund", "billing_payment", "billing_subscription"],
    accent: "violet",
    capabilities: [
      { name: "Invoices", description: "Retrieves invoice totals, line items and payment state" },
      { name: "Refund tracking", description: "Reports refund status and expected completion date" },
      { name: "Payment history", description: "Lists recent charges, including failures" },
      { name: "Subscriptions", description: "Explains plan, renewal date and billing interval" },
    ],
    tools: [
      { name: "getInvoiceDetails", description: "One invoice by number, or the most recent" },
      { name: "listInvoices", description: "Recent invoices with status and amounts" },
      { name: "checkRefundStatus", description: "Refund progress by refund or order number" },
      { name: "listPayments", description: "Recent payments, useful for duplicate-charge claims" },
      { name: "getSubscription", description: "Current plan, price, renewal date and seats" },
    ],
  },
};

export const ALL_AGENTS: AgentDefinition[] = Object.values(AGENT_REGISTRY);

export function getAgentDefinition(type: AgentType): AgentDefinition {
  return AGENT_REGISTRY[type];
}

/**
 * Compact menu injected into the router's prompt. Generated from the registry
 * so the classifier can never be offered an agent that does not exist.
 */
export function buildRoutingMenu(): string {
  return ALL_AGENTS.map((agent) => {
    const tools = agent.tools.map((t) => t.name).join(", ");
    return `- ${agent.type}: ${agent.description}\n  intents: ${agent.handles.join(", ")}\n  tools: ${tools}`;
  }).join("\n");
}
