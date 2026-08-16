import {
  and,
  desc,
  eq,
  invoices,
  payments,
  refunds,
  subscriptions,
  type Invoice,
  type Payment,
  type Refund,
  type Subscription,
} from "@repo/db";
import { db } from "../db.js";

export const billingRepository = {
  async findInvoiceByNumber(userId: string, invoiceNumber: string): Promise<Invoice | null> {
    const [row] = await db
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.userId, userId), eq(invoices.invoiceNumber, invoiceNumber.toUpperCase())),
      )
      .limit(1);
    return row ?? null;
  },

  async listInvoices(userId: string, limit = 10): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, userId))
      .orderBy(desc(invoices.issuedAt))
      .limit(limit);
  },

  async findInvoiceByOrderId(userId: string, orderId: string): Promise<Invoice | null> {
    const [row] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.userId, userId), eq(invoices.orderId, orderId)))
      .limit(1);
    return row ?? null;
  },

  async listPayments(userId: string, limit = 10): Promise<Payment[]> {
    return db
      .select()
      .from(payments)
      .where(eq(payments.userId, userId))
      .orderBy(desc(payments.processedAt))
      .limit(limit);
  },

  async listRefunds(userId: string, limit = 10): Promise<Refund[]> {
    return db
      .select()
      .from(refunds)
      .where(eq(refunds.userId, userId))
      .orderBy(desc(refunds.requestedAt))
      .limit(limit);
  },

  async findRefundByNumber(userId: string, refundNumber: string): Promise<Refund | null> {
    const [row] = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.userId, userId), eq(refunds.refundNumber, refundNumber.toUpperCase())))
      .limit(1);
    return row ?? null;
  },

  async findRefundsByOrderId(userId: string, orderId: string): Promise<Refund[]> {
    return db
      .select()
      .from(refunds)
      .where(and(eq(refunds.userId, userId), eq(refunds.orderId, orderId)))
      .orderBy(desc(refunds.requestedAt));
  },

  async findSubscription(userId: string): Promise<Subscription | null> {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.startedAt))
      .limit(1);
    return row ?? null;
  },
};
