import { tool } from "ai";
import { z } from "zod";
import { billingRepository } from "../../repositories/billing.repository.js";
import { orderRepository } from "../../repositories/order.repository.js";
import { daysBetween, formatDate, formatMoney } from "../../lib/format.js";
import { toolContextSchema } from "./context.js";
import type { Invoice, Refund } from "@repo/db";

function serialiseInvoice(invoice: Invoice) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issuedAt: formatDate(invoice.issuedAt),
    dueAt: formatDate(invoice.dueAt),
    paidAt: formatDate(invoice.paidAt),
    amountDue: formatMoney(invoice.amountDueCents, invoice.currency),
    amountPaid: formatMoney(invoice.amountPaidCents, invoice.currency),
    outstanding: formatMoney(
      Math.max(invoice.amountDueCents - invoice.amountPaidCents, 0),
      invoice.currency,
    ),
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: formatMoney(li.unitPriceCents, invoice.currency),
    })),
  };
}

function serialiseRefund(refund: Refund) {
  const expected = refund.expectedCompletionAt;
  return {
    refundNumber: refund.refundNumber,
    status: refund.status,
    amount: formatMoney(refund.amountCents, refund.currency),
    reason: refund.reason,
    requestedAt: formatDate(refund.requestedAt),
    expectedCompletionAt: formatDate(expected),
    completedAt: formatDate(refund.completedAt),
    // Pre-computing this stops the model doing date arithmetic, which is one
    // of the things LLMs are reliably bad at.
    daysUntilExpected:
      expected && !refund.completedAt ? daysBetween(new Date(), new Date(expected)) : null,
  };
}

export const billingTools = {
  getInvoiceDetails: tool({
    description:
      "Get one invoice with its line items, totals and payment status. Use for 'what am I being charged for' and 'send me my invoice'.",
    inputSchema: z.object({
      invoiceNumber: z
        .string()
        .regex(/^INV-\d{4}$/i, "Invoice numbers look like INV-2041")
        .optional()
        .describe("Invoice number, e.g. INV-2041. Omit to use the most recent invoice."),
      orderNumber: z
        .string()
        .regex(/^ORD-\d{4}$/i)
        .optional()
        .describe("Look up the invoice attached to this order instead."),
    }),
    contextSchema: toolContextSchema,
    execute: async ({ invoiceNumber, orderNumber }, { context }) => {
      let invoice: Invoice | null = null;

      if (invoiceNumber) {
        invoice = await billingRepository.findInvoiceByNumber(context.userId, invoiceNumber);
      } else if (orderNumber) {
        const order = await orderRepository.findByNumber(context.userId, orderNumber);
        invoice = order
          ? await billingRepository.findInvoiceByOrderId(context.userId, order.id)
          : null;
      } else {
        const [latest] = await billingRepository.listInvoices(context.userId, 1);
        invoice = latest ?? null;
      }

      if (!invoice) {
        return { found: false as const, message: "No matching invoice on this account." };
      }
      return { found: true as const, invoice: serialiseInvoice(invoice) };
    },
  }),

  listInvoices: tool({
    description:
      "List recent invoices with status and amounts. Use to find an invoice the customer cannot name, or to show billing history.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(10).default(5),
    }),
    contextSchema: toolContextSchema,
    execute: async ({ limit }, { context }) => {
      const invoices = await billingRepository.listInvoices(context.userId, limit);
      return {
        count: invoices.length,
        invoices: invoices.map((i) => ({
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          issuedAt: formatDate(i.issuedAt),
          amountDue: formatMoney(i.amountDueCents, i.currency),
        })),
      };
    },
  }),

  listPayments: tool({
    description:
      "List recent payments including failed ones. Essential for duplicate-charge or 'I was charged twice' complaints — check here before promising anything.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(10).default(6),
    }),
    contextSchema: toolContextSchema,
    execute: async ({ limit }, { context }) => {
      const payments = await billingRepository.listPayments(context.userId, limit);
      return {
        count: payments.length,
        payments: payments.map((p) => ({
          amount: formatMoney(p.amountCents, p.currency),
          status: p.status,
          method: `${p.method.brand} ending ${p.method.last4}`,
          processedAt: formatDate(p.processedAt),
          failureReason: p.failureReason,
          reference: p.providerRef,
        })),
      };
    },
  }),

  checkRefundStatus: tool({
    description:
      "Check the progress of a refund by refund number, or by the order it relates to. Use whenever the customer asks where their money is.",
    inputSchema: z.object({
      refundNumber: z
        .string()
        .regex(/^REF-\d{4}$/i, "Refund numbers look like REF-3007")
        .optional(),
      orderNumber: z
        .string()
        .regex(/^ORD-\d{4}$/i)
        .optional()
        .describe("Find refunds raised against this order."),
    }),
    contextSchema: toolContextSchema,
    execute: async ({ refundNumber, orderNumber }, { context }) => {
      if (refundNumber) {
        const refund = await billingRepository.findRefundByNumber(context.userId, refundNumber);
        return refund
          ? { found: true as const, refunds: [serialiseRefund(refund)] }
          : { found: false as const, message: `No refund ${refundNumber.toUpperCase()} found.` };
      }

      if (orderNumber) {
        const order = await orderRepository.findByNumber(context.userId, orderNumber);
        if (!order) {
          return { found: false as const, message: `No order ${orderNumber.toUpperCase()} found.` };
        }
        const refunds = await billingRepository.findRefundsByOrderId(context.userId, order.id);
        return refunds.length
          ? { found: true as const, refunds: refunds.map(serialiseRefund) }
          : {
              found: false as const,
              message: `No refund has been raised against ${order.orderNumber} yet.`,
            };
      }

      const refunds = await billingRepository.listRefunds(context.userId, 5);
      return refunds.length
        ? { found: true as const, refunds: refunds.map(serialiseRefund) }
        : { found: false as const, message: "No refunds on this account." };
    },
  }),

  getSubscription: tool({
    description:
      "Get the customer's subscription: plan, price, billing interval, renewal date and whether it is set to cancel.",
    inputSchema: z.object({}),
    contextSchema: toolContextSchema,
    execute: async (_input, { context }) => {
      const sub = await billingRepository.findSubscription(context.userId);
      if (!sub) {
        return { found: false as const, message: "This customer has no subscription." };
      }
      return {
        found: true as const,
        subscription: {
          plan: sub.plan,
          status: sub.status,
          price: `${formatMoney(sub.pricePerPeriodCents)} per ${sub.billingInterval}`,
          seats: sub.seats,
          currentPeriodStart: formatDate(sub.currentPeriodStart),
          renewsOn: formatDate(sub.currentPeriodEnd),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          daysUntilRenewal: daysBetween(new Date(), new Date(sub.currentPeriodEnd)),
        },
      };
    },
  }),
};

export const BILLING_TOOL_NAMES = Object.keys(billingTools);
