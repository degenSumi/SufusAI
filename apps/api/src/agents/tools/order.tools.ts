import { tool } from "ai";
import { z } from "zod";
import { orderRepository } from "../../repositories/order.repository.js";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format.js";
import { toolContextSchema } from "./context.js";
import type { Order } from "@repo/db";

/** Statuses past the point of no return — cancellation must be refused. */
const UNCANCELLABLE = new Set(["shipped", "out_for_delivery", "delivered", "returned"]);

function serialiseOrder(order: Order) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: formatDate(order.placedAt),
    items: order.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: formatMoney(item.unitPriceCents, order.currency),
    })),
    subtotal: formatMoney(order.subtotalCents, order.currency),
    shipping: formatMoney(order.shippingCents, order.currency),
    tax: formatMoney(order.taxCents, order.currency),
    total: formatMoney(order.totalCents, order.currency),
    shipTo: `${order.shippingAddress.city}, ${order.shippingAddress.state}`,
    cancelledAt: formatDate(order.cancelledAt),
    cancellationReason: order.cancellationReason,
  };
}

const orderNumberInput = z
  .string()
  .regex(/^ORD-\d{4}$/i, "Order numbers look like ORD-1023")
  .optional()
  .describe(
    "The order number, e.g. ORD-1023. Omit to use the customer's most recent order — do this when they say 'my order' or 'my last order' without naming one.",
  );

export const orderTools = {
  getOrderDetails: tool({
    description:
      "Get full details of one order: line items, totals, status and dates. Use this first for any question about what an order contains or what state it is in.",
    inputSchema: z.object({ orderNumber: orderNumberInput }),
    contextSchema: toolContextSchema,
    execute: async ({ orderNumber }, { context }) => {
      const order = orderNumber
        ? await orderRepository.findByNumber(context.userId, orderNumber)
        : await orderRepository.findMostRecent(context.userId);

      if (!order) {
        // Tools return structured failures rather than throwing: a throw ends
        // the agent loop, whereas this lets the model recover — usually by
        // asking the customer to confirm the number.
        return {
          found: false as const,
          message: orderNumber
            ? `No order ${orderNumber.toUpperCase()} exists on this account.`
            : "This customer has no orders yet.",
        };
      }

      return { found: true as const, order: serialiseOrder(order) };
    },
  }),

  listMyOrders: tool({
    description:
      "List the customer's recent orders, newest first. Use when they ask what they have ordered, or when they describe an order by product instead of by number.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(10).default(5).describe("How many orders to return"),
    }),
    contextSchema: toolContextSchema,
    execute: async ({ limit }, { context }) => {
      const orders = await orderRepository.listForUser(context.userId, limit);
      return {
        count: orders.length,
        orders: orders.map((o) => ({
          orderNumber: o.orderNumber,
          status: o.status,
          placedAt: formatDate(o.placedAt),
          total: formatMoney(o.totalCents, o.currency),
          summary: o.items.map((i) => `${i.quantity}× ${i.name}`).join(", "),
        })),
      };
    },
  }),

  checkDeliveryStatus: tool({
    description:
      "Get live shipping information for an order: carrier, tracking number, current location, estimated delivery date and the tracking event history. Use for 'where is my order' and 'when will it arrive'.",
    inputSchema: z.object({ orderNumber: orderNumberInput }),
    contextSchema: toolContextSchema,
    execute: async ({ orderNumber }, { context }) => {
      const order = orderNumber
        ? await orderRepository.findByNumber(context.userId, orderNumber)
        : await orderRepository.findMostRecent(context.userId);

      if (!order) {
        return { found: false as const, message: "No matching order on this account." };
      }

      if (order.status === "cancelled") {
        return {
          found: true as const,
          orderNumber: order.orderNumber,
          shipped: false as const,
          message: `Order ${order.orderNumber} was cancelled on ${formatDate(order.cancelledAt)}, so there is no shipment.`,
        };
      }

      const shipment = await orderRepository.findShipmentByOrderId(order.id);
      if (!shipment) {
        return {
          found: true as const,
          orderNumber: order.orderNumber,
          shipped: false as const,
          message: `Order ${order.orderNumber} is ${order.status} and has not shipped yet, so no tracking number exists.`,
        };
      }

      return {
        found: true as const,
        orderNumber: order.orderNumber,
        shipped: true as const,
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        status: shipment.status,
        lastLocation: shipment.lastLocation,
        estimatedDelivery: formatDate(shipment.estimatedDelivery),
        deliveredAt: formatDateTime(shipment.deliveredAt),
        recentEvents: shipment.events.slice(-4),
      };
    },
  }),

  cancelOrder: tool({
    description:
      "Cancel an order. Only works before the order ships. Always confirm the order number with the customer before calling this — it changes their account.",
    inputSchema: z.object({
      orderNumber: z
        .string()
        .regex(/^ORD-\d{4}$/i, "Order numbers look like ORD-1023")
        .describe("The order number to cancel. Required — never guess this one."),
      reason: z.string().min(3).describe("The customer's stated reason for cancelling"),
    }),
    contextSchema: toolContextSchema,
    execute: async ({ orderNumber, reason }, { context }) => {
      const order = await orderRepository.findByNumber(context.userId, orderNumber);

      if (!order) {
        return {
          cancelled: false as const,
          reason: `No order ${orderNumber.toUpperCase()} exists on this account.`,
        };
      }

      if (order.status === "cancelled") {
        return {
          cancelled: false as const,
          reason: `Order ${order.orderNumber} was already cancelled on ${formatDate(order.cancelledAt)}.`,
        };
      }

      // The business rule lives here, in code — not in the prompt. Prompts are
      // suggestions; this is a guarantee. The model gets told *why* so it can
      // explain the policy and offer the returns path instead.
      if (UNCANCELLABLE.has(order.status)) {
        return {
          cancelled: false as const,
          reason: `Order ${order.orderNumber} is already ${order.status.replace(/_/g, " ")} and can no longer be cancelled. Offer the customer a return once it arrives instead.`,
          policy: "Orders can only be cancelled before they ship.",
        };
      }

      const updated = await orderRepository.cancel(order.id, reason);
      return {
        cancelled: true as const,
        orderNumber: order.orderNumber,
        refundAmount: formatMoney(order.totalCents, order.currency),
        cancelledAt: formatDate(updated?.cancelledAt),
        note: "The refund returns to the original payment method within 5-7 business days.",
      };
    },
  }),
};

export const ORDER_TOOL_NAMES = Object.keys(orderTools);
