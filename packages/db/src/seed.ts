import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client.js";
import {
  conversationSummaries,
  conversations,
  invoices,
  kbArticles,
  messages,
  orders,
  payments,
  refunds,
  shipments,
  subscriptions,
  users,
} from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to the repo-root .env file.");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL);

/** Everything is seeded relative to "now" so the demo never goes stale. */
const now = Date.now();
const days = (n: number) => new Date(now + n * 86_400_000);

async function seed() {
  console.log("Clearing existing data…");
  // Child-first, so foreign keys never block a delete.
  await db.delete(conversationSummaries);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(refunds);
  await db.delete(payments);
  await db.delete(invoices);
  await db.delete(shipments);
  await db.delete(orders);
  await db.delete(subscriptions);
  await db.delete(kbArticles);
  await db.delete(users);

  console.log("Seeding customer…");
  const [customer] = await db
    .insert(users)
    .values({ email: "alex.morgan@example.com", name: "Alex Morgan" })
    .returning();
  if (!customer) throw new Error("Failed to seed user");
  const userId = customer.id;

  console.log("Seeding orders…");
  const orderRows = await db
    .insert(orders)
    .values([
      {
        orderNumber: "ORD-1021",
        userId,
        status: "delivered",
        items: [
          { sku: "AUD-HP-900", name: "Aurora HP900 Headphones", quantity: 1, unitPriceCents: 24900 },
        ],
        shippingAddress: {
          line1: "48 Marlow Street",
          city: "Portland",
          state: "OR",
          postalCode: "97205",
          country: "US",
        },
        subtotalCents: 24900,
        shippingCents: 0,
        taxCents: 2117,
        totalCents: 27017,
        placedAt: days(-24),
        updatedAt: days(-18),
      },
      {
        orderNumber: "ORD-1022",
        userId,
        status: "cancelled",
        items: [
          { sku: "KEY-MX-11", name: "Meridian MX11 Keyboard", quantity: 1, unitPriceCents: 12900 },
        ],
        shippingAddress: {
          line1: "48 Marlow Street",
          city: "Portland",
          state: "OR",
          postalCode: "97205",
          country: "US",
        },
        subtotalCents: 12900,
        shippingCents: 599,
        taxCents: 1147,
        totalCents: 14646,
        placedAt: days(-15),
        cancelledAt: days(-14),
        cancellationReason: "Ordered the wrong switch type",
        updatedAt: days(-14),
      },
      {
        // The centrepiece of the demo: in transit, so it has live tracking and
        // is past the point where cancellation is allowed.
        orderNumber: "ORD-1023",
        userId,
        status: "shipped",
        items: [
          { sku: "STD-LP-04", name: "Corvo Laptop Stand", quantity: 1, unitPriceCents: 7900 },
          { sku: "HUB-USB-7", name: "Corvo 7-Port USB-C Hub", quantity: 2, unitPriceCents: 5900 },
        ],
        shippingAddress: {
          line1: "48 Marlow Street",
          city: "Portland",
          state: "OR",
          postalCode: "97205",
          country: "US",
        },
        subtotalCents: 19700,
        shippingCents: 899,
        taxCents: 1751,
        totalCents: 22350,
        placedAt: days(-4),
        updatedAt: days(-1),
      },
      {
        // Still processing, so cancellation SHOULD succeed — the happy path for
        // the cancel tool, to contrast with ORD-1023's refusal.
        orderNumber: "ORD-1024",
        userId,
        status: "processing",
        items: [
          { sku: "MON-27-4K", name: "Lumen 27\" 4K Monitor", quantity: 1, unitPriceCents: 44900 },
        ],
        shippingAddress: {
          line1: "48 Marlow Street",
          city: "Portland",
          state: "OR",
          postalCode: "97205",
          country: "US",
        },
        subtotalCents: 44900,
        shippingCents: 0,
        taxCents: 3817,
        totalCents: 48717,
        placedAt: days(-2),
        updatedAt: days(-2),
      },
      {
        orderNumber: "ORD-1025",
        userId,
        status: "delivered",
        items: [{ sku: "CAM-WB-2K", name: "Vista 2K Webcam", quantity: 1, unitPriceCents: 8900 }],
        shippingAddress: {
          line1: "48 Marlow Street",
          city: "Portland",
          state: "OR",
          postalCode: "97205",
          country: "US",
        },
        subtotalCents: 8900,
        shippingCents: 599,
        taxCents: 807,
        totalCents: 10306,
        placedAt: days(-9),
        updatedAt: days(-4),
      },
      {
        orderNumber: "ORD-1026",
        userId,
        status: "pending",
        items: [
          { sku: "CBL-TB4-2", name: "Thunderbolt 4 Cable (2m)", quantity: 3, unitPriceCents: 3400 },
        ],
        shippingAddress: {
          line1: "48 Marlow Street",
          city: "Portland",
          state: "OR",
          postalCode: "97205",
          country: "US",
        },
        subtotalCents: 10200,
        shippingCents: 599,
        taxCents: 918,
        totalCents: 11717,
        placedAt: days(0),
        updatedAt: days(0),
      },
    ])
    .returning();

  const byNumber = new Map(orderRows.map((o) => [o.orderNumber, o]));
  const ord = (n: string) => {
    const row = byNumber.get(n);
    if (!row) throw new Error(`Seed error: ${n} missing`);
    return row;
  };

  console.log("Seeding shipments…");
  await db.insert(shipments).values([
    {
      orderId: ord("ORD-1021").id,
      carrier: "Cascade Freight",
      trackingNumber: "CF884210773US",
      status: "delivered",
      shippedAt: days(-22),
      deliveredAt: days(-18),
      estimatedDelivery: days(-19),
      lastLocation: "Portland, OR",
      events: [
        { at: days(-22).toISOString(), status: "in_transit", location: "Reno, NV", description: "Departed sorting facility" },
        { at: days(-19).toISOString(), status: "out_for_delivery", location: "Portland, OR", description: "Out for delivery" },
        { at: days(-18).toISOString(), status: "delivered", location: "Portland, OR", description: "Left with resident" },
      ],
    },
    {
      orderId: ord("ORD-1023").id,
      carrier: "Cascade Freight",
      trackingNumber: "CF991447206US",
      status: "in_transit",
      shippedAt: days(-2),
      estimatedDelivery: days(2),
      lastLocation: "Sacramento, CA",
      events: [
        { at: days(-2).toISOString(), status: "label_created", location: "Fresno, CA", description: "Shipping label created" },
        { at: days(-1).toISOString(), status: "in_transit", location: "Sacramento, CA", description: "Arrived at regional hub" },
      ],
    },
    {
      orderId: ord("ORD-1025").id,
      carrier: "Northlink Post",
      trackingNumber: "NL5520148832",
      status: "delivered",
      shippedAt: days(-7),
      deliveredAt: days(-4),
      estimatedDelivery: days(-5),
      lastLocation: "Portland, OR",
      events: [
        { at: days(-7).toISOString(), status: "in_transit", location: "Seattle, WA", description: "Accepted at facility" },
        { at: days(-4).toISOString(), status: "delivered", location: "Portland, OR", description: "Delivered to mailbox" },
      ],
    },
  ]);

  console.log("Seeding invoices…");
  const invoiceRows = await db
    .insert(invoices)
    .values([
      {
        invoiceNumber: "INV-2041",
        userId,
        orderId: ord("ORD-1021").id,
        status: "paid",
        lineItems: [{ description: "Aurora HP900 Headphones", quantity: 1, unitPriceCents: 24900 }],
        amountDueCents: 27017,
        amountPaidCents: 27017,
        issuedAt: days(-24),
        paidAt: days(-24),
      },
      {
        invoiceNumber: "INV-2042",
        userId,
        orderId: ord("ORD-1022").id,
        status: "refunded",
        lineItems: [{ description: "Meridian MX11 Keyboard", quantity: 1, unitPriceCents: 12900 }],
        amountDueCents: 14646,
        amountPaidCents: 0,
        issuedAt: days(-15),
      },
      {
        invoiceNumber: "INV-2043",
        userId,
        orderId: ord("ORD-1023").id,
        status: "paid",
        lineItems: [
          { description: "Corvo Laptop Stand", quantity: 1, unitPriceCents: 7900 },
          { description: "Corvo 7-Port USB-C Hub", quantity: 2, unitPriceCents: 5900 },
        ],
        amountDueCents: 22350,
        amountPaidCents: 22350,
        issuedAt: days(-4),
        paidAt: days(-4),
      },
      {
        invoiceNumber: "INV-2044",
        userId,
        orderId: ord("ORD-1024").id,
        status: "open",
        lineItems: [{ description: 'Lumen 27" 4K Monitor', quantity: 1, unitPriceCents: 44900 }],
        amountDueCents: 48717,
        amountPaidCents: 0,
        issuedAt: days(-2),
        dueAt: days(12),
      },
      {
        invoiceNumber: "INV-2045",
        userId,
        orderId: ord("ORD-1025").id,
        status: "paid",
        lineItems: [{ description: "Vista 2K Webcam", quantity: 1, unitPriceCents: 8900 }],
        amountDueCents: 10306,
        amountPaidCents: 10306,
        issuedAt: days(-9),
        paidAt: days(-9),
      },
      {
        invoiceNumber: "INV-2046",
        userId,
        status: "overdue",
        lineItems: [{ description: "Sufus Plus — monthly", quantity: 1, unitPriceCents: 999 }],
        amountDueCents: 999,
        amountPaidCents: 0,
        issuedAt: days(-38),
        dueAt: days(-8),
      },
    ])
    .returning();

  const invByNumber = new Map(invoiceRows.map((i) => [i.invoiceNumber, i]));
  const inv = (n: string) => {
    const row = invByNumber.get(n);
    if (!row) throw new Error(`Seed error: ${n} missing`);
    return row;
  };

  console.log("Seeding payments…");
  const card = { brand: "Visa", last4: "4291", type: "card" as const };

  const paymentRows = await db
    .insert(payments)
    .values([
      {
        userId,
        invoiceId: inv("INV-2041").id,
        orderId: ord("ORD-1021").id,
        status: "succeeded",
        amountCents: 27017,
        method: card,
        providerRef: "pay_8fa21c",
        processedAt: days(-24),
      },
      {
        userId,
        invoiceId: inv("INV-2043").id,
        orderId: ord("ORD-1023").id,
        status: "succeeded",
        amountCents: 22350,
        method: card,
        providerRef: "pay_9b7e40",
        processedAt: days(-4),
      },
      // The duplicate-charge scenario: two identical successful captures on
      // ORD-1025, minutes apart. This is what makes "I was charged twice" a
      // real investigation for the billing agent rather than a canned answer.
      {
        userId,
        invoiceId: inv("INV-2045").id,
        orderId: ord("ORD-1025").id,
        status: "succeeded",
        amountCents: 10306,
        method: card,
        providerRef: "pay_1c4d92",
        processedAt: days(-9),
      },
      {
        userId,
        invoiceId: inv("INV-2045").id,
        orderId: ord("ORD-1025").id,
        status: "refunded",
        amountCents: 10306,
        method: card,
        providerRef: "pay_1c4d93",
        processedAt: days(-9),
      },
      {
        userId,
        invoiceId: inv("INV-2046").id,
        status: "failed",
        amountCents: 999,
        method: card,
        providerRef: "pay_7de001",
        failureReason: "Card declined — insufficient funds",
        processedAt: days(-8),
      },
    ])
    .returning();

  console.log("Seeding refunds…");
  await db.insert(refunds).values([
    {
      refundNumber: "REF-3006",
      userId,
      orderId: ord("ORD-1022").id,
      invoiceId: inv("INV-2042").id,
      status: "completed",
      amountCents: 14646,
      reason: "Order cancelled before dispatch",
      requestedAt: days(-14),
      expectedCompletionAt: days(-8),
      completedAt: days(-9),
    },
    {
      // Deliberately still in flight, with an ETA in the future — so
      // checkRefundStatus has something interesting to report.
      refundNumber: "REF-3007",
      userId,
      paymentId: paymentRows[3]?.id,
      orderId: ord("ORD-1025").id,
      invoiceId: inv("INV-2045").id,
      status: "processing",
      amountCents: 10306,
      reason: "Duplicate charge on the same order",
      requestedAt: days(-3),
      expectedCompletionAt: days(4),
    },
  ]);

  console.log("Seeding subscription…");
  await db.insert(subscriptions).values({
    userId,
    plan: "Sufus Plus",
    status: "past_due",
    pricePerPeriodCents: 999,
    billingInterval: "month",
    seats: 1,
    currentPeriodStart: days(-8),
    currentPeriodEnd: days(22),
    cancelAtPeriodEnd: false,
    startedAt: days(-400),
  });

  console.log("Seeding knowledge base…");
  await db.insert(kbArticles).values([
    {
      slug: "return-window",
      title: "How long do I have to return an item?",
      category: "Returns",
      keywords: "return window returns policy send back 30 days exchange",
      body: "You can return most items within 30 days of delivery for a full refund. Items must be in their original packaging with all accessories. Opened software, digital licences and clearance items are final sale. Start a return from Orders → Return this item, and we email a prepaid label within one business day.",
    },
    {
      slug: "refund-timeline",
      title: "When will my refund arrive?",
      category: "Billing",
      keywords: "refund timeline how long money back credited bank statement",
      body: "Once a return is received and inspected, refunds are issued within 2 business days. The money then takes 5-7 business days to appear, depending on your bank. Card refunds return to the original card; if that card is closed, contact support and we arrange a bank transfer.",
    },
    {
      slug: "cancel-order",
      title: "Can I cancel my order?",
      category: "Orders",
      keywords: "cancel order cancellation stop change mind before shipping",
      body: "Orders can be cancelled at any point before they ship. Once an order is marked shipped it is with the carrier and cannot be recalled — in that case refuse the delivery or start a free return once it arrives. Cancellations are refunded to the original payment method within 5-7 business days.",
    },
    {
      slug: "tracking-not-updating",
      title: "My tracking has not updated in days",
      category: "Shipping",
      keywords: "tracking not updating stuck no movement package delayed lost",
      body: "Carriers usually scan a package at each hub, not continuously — 48 hours without a scan is normal during busy periods, especially in transit between states. If there has been no scan for 7 days, the package is considered delayed: contact us and we will open a carrier trace and ship a replacement if it is not located within 3 business days.",
    },
    {
      slug: "reset-password",
      title: "How do I reset my password?",
      category: "Account",
      keywords: "password reset forgot login cannot sign in locked out",
      body: "Go to the sign-in page and choose Forgot password. Enter your account email and we send a reset link valid for 30 minutes. If the email does not arrive, check spam and confirm you are using the address on your order confirmations. After five failed attempts the account locks for 15 minutes.",
    },
    {
      slug: "change-email",
      title: "Changing the email on my account",
      category: "Account",
      keywords: "change email address update account details",
      body: "Open Account → Profile → Email and enter the new address. We send a confirmation link to the new address and a notification to the old one. The change takes effect once confirmed. Invoices already issued keep the old address for accounting reasons.",
    },
    {
      slug: "damaged-on-arrival",
      title: "My item arrived damaged",
      category: "Returns",
      keywords: "damaged broken cracked arrived faulty defective replacement",
      body: "Report damage within 48 hours of delivery. Photograph the item and the outer box, then contact support with your order number. We ship a replacement immediately at no cost and include a prepaid label for the damaged unit — you do not need to wait for the return to arrive before the replacement is sent.",
    },
    {
      slug: "warranty",
      title: "What does the warranty cover?",
      category: "Products",
      keywords: "warranty guarantee cover repair 2 years faulty",
      body: "All Sufus-branded hardware carries a 2-year warranty against manufacturing defects. Third-party brands carry the manufacturer's own warranty, usually 12 months. The warranty does not cover accidental damage, liquid damage or normal battery wear. Warranty claims need the order number and a short description of the fault.",
    },
    {
      slug: "headphone-crackling",
      title: "Troubleshooting audio crackling on headphones",
      category: "Troubleshooting",
      keywords: "headphones crackling static audio noise popping one ear sound",
      body: "Crackling in one ear is usually a connection or codec problem rather than a hardware fault. Try, in order: 1) forget the device in Bluetooth settings and re-pair it, 2) disable audio enhancements in your OS sound settings, 3) switch the codec from aptX to AAC or SBC in the companion app, 4) test on a second device to isolate the source. If it persists on a second device, it is a hardware fault and covered by warranty.",
    },
    {
      slug: "shipping-options",
      title: "Shipping options and delivery times",
      category: "Shipping",
      keywords: "shipping speed delivery time standard express free how much",
      body: "Standard shipping is 3-5 business days and free on orders over $150. Express is 1-2 business days at $8.99. Orders placed after 2pm local time are processed the next business day. We ship within the continental US only; Alaska, Hawaii and PO boxes may add 2 business days.",
    },
    {
      slug: "support-hours",
      title: "When can I reach a human?",
      category: "Support",
      keywords: "contact hours phone human agent talk speak escalate",
      body: "Live chat and phone support run Monday to Friday, 7am to 7pm Pacific, and Saturday 9am to 4pm. Outside those hours this assistant can still look up orders, invoices and refunds. To reach a person, ask to escalate and we create a ticket with a callback within one business day.",
    },
  ]);

  console.log("Seeding prior conversations…");
  // Two closed conversations from earlier weeks. These exist so the Support
  // agent's `searchConversationHistory` tool returns real cross-conversation
  // results on the very first message of the demo, rather than an empty set.
  const [audioChat, returnsChat] = await db
    .insert(conversations)
    .values([
      {
        userId,
        title: "Headphones crackling in the left ear",
        lastAgentType: "support",
        createdAt: days(-17),
        updatedAt: days(-17),
      },
      {
        userId,
        title: "Returning the keyboard I ordered by mistake",
        lastAgentType: "order",
        createdAt: days(-14),
        updatedAt: days(-14),
      },
    ])
    .returning();

  if (!audioChat || !returnsChat) throw new Error("Failed to seed conversations");

  await db.insert(messages).values([
    {
      conversationId: audioChat.id,
      role: "user",
      content:
        "The Aurora HP900 headphones from ORD-1021 keep crackling in the left ear when I'm on calls.",
      createdAt: days(-17),
    },
    {
      conversationId: audioChat.id,
      role: "assistant",
      agentType: "support",
      intent: "support_troubleshoot",
      routeSource: "llm",
      routeConfidence: 0.91,
      routeReasoning: "Product fault description — troubleshooting, not order status.",
      content:
        "Crackling in one ear is almost always a pairing or codec issue rather than a broken driver. Try re-pairing the headphones from scratch, then switch the codec from aptX to AAC in the Aurora app. If it still crackles on a second device, it's a hardware fault and your 2-year warranty covers a replacement.",
      createdAt: days(-17),
    },
    {
      conversationId: audioChat.id,
      role: "user",
      content: "Re-pairing fixed it, thanks. I'll shout if it comes back.",
      createdAt: days(-17),
    },
    {
      conversationId: returnsChat.id,
      role: "user",
      content: "I ordered the Meridian MX11 keyboard with the wrong switches, can I cancel ORD-1022?",
      createdAt: days(-14),
    },
    {
      conversationId: returnsChat.id,
      role: "assistant",
      agentType: "order",
      intent: "order_cancel",
      routeSource: "heuristic",
      routeConfidence: 0.95,
      routeReasoning: "Message contains an order number and no billing language.",
      content:
        "Done — ORD-1022 hadn't shipped yet, so I've cancelled it. Your $146.46 goes back to the Visa ending 4291 within 5-7 business days.",
      createdAt: days(-14),
    },
  ]);

  console.log("\nSeed complete.");
  console.log(`  customer      ${customer.name} <${customer.email}>`);
  console.log(`  orders        ${orderRows.length}`);
  console.log(`  invoices      ${invoiceRows.length}`);
  console.log(`  payments      ${paymentRows.length}`);
  console.log(`  kb articles   11`);
  console.log(`  prior chats   2\n`);
  console.log("  Try: \"where is my order ORD-1023?\" then \"when will it get here?\"\n");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  });
