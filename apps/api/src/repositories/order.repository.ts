import { and, desc, eq, orders, shipments, type Order, type Shipment } from "@repo/db";
import { db } from "../db.js";

// Every read is scoped by userId — these run on model-supplied input.
export const orderRepository = {
  async findByNumber(userId: string, orderNumber: string): Promise<Order | null> {
    const [row] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.orderNumber, orderNumber.toUpperCase())))
      .limit(1);
    return row ?? null;
  },

  async listForUser(userId: string, limit = 10): Promise<Order[]> {
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.placedAt))
      .limit(limit);
  },

  async findMostRecent(userId: string): Promise<Order | null> {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.placedAt))
      .limit(1);
    return row ?? null;
  },

  async findShipmentByOrderId(orderId: string): Promise<Shipment | null> {
    const [row] = await db
      .select()
      .from(shipments)
      .where(eq(shipments.orderId, orderId))
      .limit(1);
    return row ?? null;
  },

  async cancel(orderId: string, reason: string): Promise<Order | null> {
    const [row] = await db
      .update(orders)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
      .returning();
    return row ?? null;
  },
};
