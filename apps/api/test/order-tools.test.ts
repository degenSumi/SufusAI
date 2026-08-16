import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Order } from "@repo/db";

const repo = vi.hoisted(() => ({
  findByNumber: vi.fn(),
  findMostRecent: vi.fn(),
  listForUser: vi.fn(),
  findShipmentByOrderId: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../src/repositories/order.repository.js", () => ({ orderRepository: repo }));

const { orderTools } = await import("../src/agents/tools/order.tools.js");

const USER = "11111111-1111-4111-8111-111111111111";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    orderNumber: "ORD-1023",
    userId: USER,
    status: "processing",
    items: [{ sku: "STD-LP-04", name: "Corvo Laptop Stand", quantity: 1, unitPriceCents: 7900 }],
    shippingAddress: {
      line1: "48 Marlow Street",
      city: "Portland",
      state: "OR",
      postalCode: "97205",
      country: "US",
    },
    subtotalCents: 7900,
    shippingCents: 899,
    taxCents: 751,
    totalCents: 9550,
    currency: "USD",
    placedAt: new Date("2026-08-10T00:00:00Z"),
    cancelledAt: null,
    cancellationReason: null,
    updatedAt: new Date("2026-08-10T00:00:00Z"),
    ...overrides,
  } as Order;
}

/** The tools receive context from the server, never from the model. */
function run<I, O>(
  tool: { execute?: (input: I, options: never) => Promise<O> },
  input: I,
  context: Record<string, unknown> = { userId: USER },
): Promise<O> {
  if (!tool.execute) throw new Error("tool has no execute");
  return tool.execute(input, { context } as never);
}

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset();
});

describe("cancelOrder business rules", () => {
  it("cancels an order that has not shipped", async () => {
    repo.findByNumber.mockResolvedValue(order({ status: "processing" }));
    repo.cancel.mockResolvedValue(order({ status: "cancelled", cancelledAt: new Date() }));

    const result = await run(orderTools.cancelOrder, {
      orderNumber: "ORD-1023",
      reason: "Changed my mind",
    });

    expect(result).toMatchObject({ cancelled: true, refundAmount: "$95.50" });
    expect(repo.cancel).toHaveBeenCalledOnce();
  });

  it.each(["shipped", "out_for_delivery", "delivered", "returned"] as const)(
    "refuses to cancel an order that is %s, and never writes",
    async (status) => {
      repo.findByNumber.mockResolvedValue(order({ status }));

      const result = await run(orderTools.cancelOrder, {
        orderNumber: "ORD-1023",
        reason: "Changed my mind",
      });

      expect(result).toMatchObject({ cancelled: false });
      expect((result as { reason: string }).reason).toContain("can no longer be cancelled");
      // The rule lives in code, not in the prompt — so it holds even if the
      // model is talked into asking for the cancellation.
      expect(repo.cancel).not.toHaveBeenCalled();
    },
  );

  it("refuses an order that was already cancelled", async () => {
    repo.findByNumber.mockResolvedValue(
      order({ status: "cancelled", cancelledAt: new Date("2026-08-12T00:00:00Z") }),
    );

    const result = await run(orderTools.cancelOrder, {
      orderNumber: "ORD-1023",
      reason: "again",
    });

    expect(result).toMatchObject({ cancelled: false });
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it("returns a structured miss rather than throwing for an unknown order", async () => {
    repo.findByNumber.mockResolvedValue(null);

    const result = await run(orderTools.cancelOrder, {
      orderNumber: "ORD-9999",
      reason: "whatever",
    });

    // Throwing would end the agent loop; this lets the model ask for the
    // correct number instead.
    expect(result).toMatchObject({ cancelled: false });
  });
});

describe("tenant scoping", () => {
  it("always passes the server-supplied userId to the repository", async () => {
    repo.findByNumber.mockResolvedValue(order());

    await run(orderTools.getOrderDetails, { orderNumber: "ORD-1023" });

    expect(repo.findByNumber).toHaveBeenCalledWith(USER, "ORD-1023");
  });

  it("exposes no userId parameter in the schema the model sees", () => {
    // The security property, asserted directly: the model cannot name a
    // customer because the field does not exist in its vocabulary.
    const schema = orderTools.getOrderDetails.inputSchema as {
      shape?: Record<string, unknown>;
    };
    expect(Object.keys(schema.shape ?? {})).toEqual(["orderNumber"]);
  });
});

describe("getOrderDetails", () => {
  it("falls back to the most recent order when no number is given", async () => {
    repo.findMostRecent.mockResolvedValue(order({ orderNumber: "ORD-1026" }));

    const result = await run(orderTools.getOrderDetails, {});

    expect(repo.findMostRecent).toHaveBeenCalledWith(USER);
    expect(result).toMatchObject({ found: true, order: { orderNumber: "ORD-1026" } });
  });

  it("formats money from integer cents", async () => {
    repo.findByNumber.mockResolvedValue(order({ totalCents: 22350 }));

    const result = (await run(orderTools.getOrderDetails, { orderNumber: "ORD-1023" })) as {
      order: { total: string };
    };

    expect(result.order.total).toBe("$223.50");
  });
});

describe("checkDeliveryStatus", () => {
  it("explains that a cancelled order has no shipment", async () => {
    repo.findByNumber.mockResolvedValue(order({ status: "cancelled", cancelledAt: new Date() }));

    const result = await run(orderTools.checkDeliveryStatus, { orderNumber: "ORD-1023" });

    expect(result).toMatchObject({ shipped: false });
    expect(repo.findShipmentByOrderId).not.toHaveBeenCalled();
  });

  it("reports not-yet-shipped rather than inventing a tracking number", async () => {
    repo.findByNumber.mockResolvedValue(order({ status: "processing" }));
    repo.findShipmentByOrderId.mockResolvedValue(null);

    const result = await run(orderTools.checkDeliveryStatus, { orderNumber: "ORD-1023" });

    expect(result).toMatchObject({ shipped: false });
  });
});
