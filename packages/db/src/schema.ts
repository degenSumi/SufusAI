import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Money is integer cents everywhere, never floats.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const agentTypeEnum = pgEnum("agent_type", ["support", "order", "billing"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
]);

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "label_created",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "open",
  "paid",
  "overdue",
  "void",
  "refunded",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "requested",
  "approved",
  "processing",
  "completed",
  "rejected",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    /** Which agent handled the most recent turn — the router's stickiness hint. */
    lastAgentType: agentTypeEnum("last_agent_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_updated_idx").on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),

    // Routing provenance — only set on assistant messages. Persisted so the
    // reasoning card survives a page reload, and so routing accuracy can be
    // audited after the fact.
    agentType: agentTypeEnum("agent_type"),
    intent: text("intent"),
    routeSource: text("route_source"),
    routeConfidence: real("route_confidence"),
    routeReasoning: text("route_reasoning"),

    /** Tool executions for this turn: [{ toolName, label, status, summary, durationMs }] */
    toolCalls: jsonb("tool_calls"),

    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

// coversThroughMessageId is what makes compaction idempotent.
export const conversationSummaries = pgTable(
  "conversation_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    coversThroughMessageId: uuid("covers_through_message_id"),
    messageCount: integer("message_count").notNull().default(0),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("summaries_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Commerce — the data the Order agent's tools read
// ---------------------------------------------------------------------------

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Address {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull().default("pending"),
    items: jsonb("items").$type<OrderItem[]>().notNull(),
    shippingAddress: jsonb("shipping_address").$type<Address>().notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_user_placed_idx").on(t.userId, t.placedAt),
    uniqueIndex("orders_number_idx").on(t.orderNumber),
  ],
);

export interface TrackingEvent {
  at: string;
  status: string;
  location: string;
  description: string;
}

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    carrier: text("carrier").notNull(),
    trackingNumber: text("tracking_number").notNull(),
    status: shipmentStatusEnum("status").notNull().default("label_created"),
    estimatedDelivery: timestamp("estimated_delivery", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastLocation: text("last_location"),
    events: jsonb("events").$type<TrackingEvent[]>().notNull().default([]),
  },
  (t) => [index("shipments_order_idx").on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Billing — the data the Billing agent's tools read
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceNumber: text("invoice_number").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    status: invoiceStatusEnum("status").notNull().default("open"),
    lineItems: jsonb("line_items").$type<InvoiceLineItem[]>().notNull(),
    amountDueCents: integer("amount_due_cents").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [index("invoices_user_issued_idx").on(t.userId, t.issuedAt)],
);

export interface PaymentMethodInfo {
  brand: string;
  last4: string;
  type: "card" | "paypal" | "bank_transfer";
}

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    status: paymentStatusEnum("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    method: jsonb("method").$type<PaymentMethodInfo>().notNull(),
    providerRef: text("provider_ref").notNull(),
    failureReason: text("failure_reason"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_user_processed_idx").on(t.userId, t.processedAt)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refundNumber: text("refund_number").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    status: refundStatusEnum("status").notNull().default("requested"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    reason: text("reason").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    expectedCompletionAt: timestamp("expected_completion_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("refunds_user_requested_idx").on(t.userId, t.requestedAt)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    pricePerPeriodCents: integer("price_per_period_cents").notNull(),
    billingInterval: text("billing_interval").notNull().default("month"),
    seats: integer("seats").notNull().default(1),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Knowledge base — the data the Support agent's tools read
// ---------------------------------------------------------------------------

export const kbArticles = pgTable(
  "kb_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    /** Space-separated search terms; kept denormalised for cheap ILIKE search. */
    keywords: text("keywords").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kb_category_idx").on(t.category)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  orders: many(orders),
  invoices: many(invoices),
  payments: many(payments),
  refunds: many(refunds),
  subscriptions: many(subscriptions),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
  summaries: many(conversationSummaries),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const conversationSummariesRelations = relations(conversationSummaries, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationSummaries.conversationId],
    references: [conversations.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  shipment: one(shipments),
  invoices: many(invoices),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, { fields: [shipments.orderId], references: [orders.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  user: one(users, { fields: [invoices.userId], references: [users.id] }),
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  refunds: many(refunds),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  user: one(users, { fields: [refunds.userId], references: [users.id] }),
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred row types — re-exported so services and agents never redeclare them
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ConversationSummaryRow = typeof conversationSummaries.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type KbArticle = typeof kbArticles.$inferSelect;
