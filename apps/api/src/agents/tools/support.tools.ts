import { tool } from "ai";
import { z } from "zod";
import { knowledgeRepository } from "../../repositories/knowledge.repository.js";
import { conversationRepository } from "../../repositories/conversation.repository.js";
import { orderRepository } from "../../repositories/order.repository.js";
import { billingRepository } from "../../repositories/billing.repository.js";
import { formatDate, formatMoney } from "../../lib/format.js";
import { supportToolContextSchema } from "./context.js";

export const supportTools = {
  searchKnowledgeBase: tool({
    description:
      "Search the help centre for articles on a topic. Use this before answering any how-to, policy or troubleshooting question — never answer those from memory, because the policies here are specific to this company.",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .describe(
          "Two or three keywords, not a full sentence. Good: 'return window'. Bad: 'how long do I have to return something I bought'.",
        ),
    }),
    contextSchema: supportToolContextSchema,
    execute: async ({ query }) => {
      const articles = await knowledgeRepository.search(query);

      if (articles.length === 0) {
        const categories = await knowledgeRepository.listCategories();
        return {
          found: false as const,
          message: `No article matched "${query}".`,
          availableCategories: categories,
        };
      }

      return {
        found: true as const,
        articles: articles.map((a) => ({
          title: a.title,
          category: a.category,
          content: a.body,
          slug: a.slug,
        })),
      };
    },
  }),

  searchConversationHistory: tool({
    description:
      "Search what this customer discussed in their EARLIER conversations. Use when they refer to a previous chat ('like I said last time', 'the issue from last week') or when you need background on a recurring problem.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Keywords to look for in past messages"),
    }),
    contextSchema: supportToolContextSchema,
    execute: async ({ query }, { context }) => {
      const hits = await conversationRepository.searchHistory(context.userId, query);

      // Exclude the live thread — the customer's just-sent message is already
      // in the prompt, and echoing it back as "history" reads as a hallucination.
      const priorOnly = hits.filter((h) => h.conversationId !== context.conversationId);

      if (priorOnly.length === 0) {
        return {
          found: false as const,
          message: `Nothing in this customer's earlier conversations mentions "${query}".`,
        };
      }

      return {
        found: true as const,
        matches: priorOnly.map((h) => ({
          conversation: h.conversationTitle,
          who: h.role === "user" ? "customer" : (h.agentType ?? "assistant"),
          said: h.content.length > 400 ? `${h.content.slice(0, 400)}…` : h.content,
          when: formatDate(h.createdAt),
        })),
      };
    },
  }),

  getCustomerSnapshot: tool({
    description:
      "Get a high-level overview of this customer's account: recent orders, outstanding invoices and subscription state. Use to orient yourself before answering a vague question, or to decide whether a question really belongs to the Order or Billing specialist.",
    inputSchema: z.object({}),
    contextSchema: supportToolContextSchema,
    execute: async (_input, { context }) => {
      // Independent reads — run them together rather than serially.
      const [orders, invoices, subscription] = await Promise.all([
        orderRepository.listForUser(context.userId, 5),
        billingRepository.listInvoices(context.userId, 5),
        billingRepository.findSubscription(context.userId),
      ]);

      const openInvoices = invoices.filter((i) => i.status === "open" || i.status === "overdue");

      return {
        recentOrders: orders.map((o) => ({
          orderNumber: o.orderNumber,
          status: o.status,
          placedAt: formatDate(o.placedAt),
          total: formatMoney(o.totalCents, o.currency),
        })),
        openInvoiceCount: openInvoices.length,
        openInvoices: openInvoices.map((i) => ({
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          amountDue: formatMoney(i.amountDueCents, i.currency),
          dueAt: formatDate(i.dueAt),
        })),
        subscription: subscription
          ? {
              plan: subscription.plan,
              status: subscription.status,
              renewsOn: formatDate(subscription.currentPeriodEnd),
            }
          : null,
      };
    },
  }),
};

export const SUPPORT_TOOL_NAMES = Object.keys(supportTools);
