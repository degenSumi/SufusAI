// Labels are derived from the real tool call and its arguments, not a timer.

type Args = Record<string, unknown>;

function str(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value.toUpperCase() : undefined;
}

const RUNNING: Record<string, (args: Args) => string> = {
  getOrderDetails: (a) =>
    str(a, "orderNumber")
      ? `Fetching order ${str(a, "orderNumber")}`
      : "Fetching your most recent order",
  listMyOrders: () => "Looking through your recent orders",
  checkDeliveryStatus: (a) =>
    str(a, "orderNumber")
      ? `Checking delivery for ${str(a, "orderNumber")}`
      : "Checking your delivery status",
  cancelOrder: (a) => `Cancelling order ${str(a, "orderNumber") ?? ""}`.trim(),

  getInvoiceDetails: (a) =>
    str(a, "invoiceNumber")
      ? `Opening invoice ${str(a, "invoiceNumber")}`
      : "Opening your latest invoice",
  listInvoices: () => "Pulling your billing history",
  listPayments: () => "Reviewing recent charges",
  checkRefundStatus: (a) =>
    str(a, "refundNumber") ?? str(a, "orderNumber")
      ? `Checking refund for ${str(a, "refundNumber") ?? str(a, "orderNumber")}`
      : "Checking your refunds",
  getSubscription: () => "Loading your subscription",

  searchKnowledgeBase: (a) => `Searching the help centre for "${a["query"] ?? ""}"`,
  searchConversationHistory: (a) => `Searching your past conversations for "${a["query"] ?? ""}"`,
  getCustomerSnapshot: () => "Reviewing your account",
};

export function labelForToolCall(toolName: string, input: unknown): string {
  const args = (input ?? {}) as Args;
  const builder = RUNNING[toolName];
  if (builder) {
    try {
      return builder(args);
    } catch {
      /* fall through to the generic label */
    }
  }
  return `Running ${toolName}`;
}

/**
 * A one-line result summary shown on the completed tool chip. Reads the shapes
 * the tools actually return so the chip says "Found 3 orders" instead of "done".
 */
export function summariseToolOutput(toolName: string, output: unknown): string | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const o = output as Args;

  if (o["found"] === false) {
    return typeof o["message"] === "string" ? o["message"] : "No match found";
  }
  if (o["cancelled"] === true) return "Order cancelled";
  if (o["cancelled"] === false) {
    return typeof o["reason"] === "string" ? o["reason"] : "Cancellation refused";
  }

  switch (toolName) {
    case "getOrderDetails": {
      const order = o["order"] as Args | undefined;
      return order ? `${order["orderNumber"]} — ${order["status"]}` : undefined;
    }
    case "listMyOrders":
      return `Found ${o["count"]} order${o["count"] === 1 ? "" : "s"}`;
    case "checkDeliveryStatus":
      return o["shipped"] === true
        ? `${o["carrier"]} — ${String(o["status"]).replace(/_/g, " ")}`
        : "Not shipped yet";
    case "getInvoiceDetails": {
      const invoice = o["invoice"] as Args | undefined;
      return invoice ? `${invoice["invoiceNumber"]} — ${invoice["status"]}` : undefined;
    }
    case "listInvoices":
      return `Found ${o["count"]} invoice${o["count"] === 1 ? "" : "s"}`;
    case "listPayments":
      return `Found ${o["count"]} payment${o["count"] === 1 ? "" : "s"}`;
    case "checkRefundStatus": {
      const refunds = o["refunds"] as Args[] | undefined;
      if (!refunds?.length) return undefined;
      const first = refunds[0];
      return refunds.length === 1
        ? `${first?.["refundNumber"]} — ${first?.["status"]}`
        : `${refunds.length} refunds found`;
    }
    case "getSubscription": {
      const sub = o["subscription"] as Args | undefined;
      return sub ? `${sub["plan"]} — ${sub["status"]}` : undefined;
    }
    case "searchKnowledgeBase": {
      const articles = o["articles"] as Args[] | undefined;
      return articles?.length ? `${articles.length} article(s) found` : undefined;
    }
    case "searchConversationHistory": {
      const matches = o["matches"] as Args[] | undefined;
      return matches?.length ? `${matches.length} earlier mention(s)` : undefined;
    }
    case "getCustomerSnapshot": {
      const orders = o["recentOrders"] as Args[] | undefined;
      return `${orders?.length ?? 0} recent orders, ${o["openInvoiceCount"]} open invoice(s)`;
    }
    default:
      return undefined;
  }
}
