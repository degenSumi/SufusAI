import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The classifier is stubbed with a plain function rather than `vi.fn()`.
 *
 * A spy records every call result, thrown errors included, and Vitest then
 * surfaces those recorded throws as test failures — even when the code under
 * test catches them, which is exactly the behaviour the failure path needs to
 * assert. Calls are therefore recorded by hand into `stub.calls`.
 *
 * Only the model call is faked. The heuristic tier, the confidence threshold
 * and the fallback construction are all the real implementations.
 */
const stub = vi.hoisted(() => ({
  calls: [] as Array<{ prompt: string }>,
  impl: null as null | (() => unknown),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (options: { prompt: string }) => {
    stub.calls.push({ prompt: options.prompt });
    if (!stub.impl) throw new Error("Test did not configure a classifier result");
    return stub.impl();
  },
}));

const { heuristicRoute, routeMessage } = await import("../src/agents/router.agent.js");

function classifierReturns(output: {
  agent: string;
  intent: string;
  confidence: number;
  reasoning?: string;
}) {
  stub.impl = () => Promise.resolve({ output: { reasoning: "because", ...output } });
}

beforeEach(() => {
  stub.calls = [];
  stub.impl = null;
});

describe("heuristic routing tier", () => {
  it("routes an order number with no billing language to the order agent", () => {
    expect(heuristicRoute("Where is ORD-1023?")).toEqual({
      agent: "order",
      reason: expect.stringContaining("order number"),
    });
  });

  it("routes invoice and refund numbers to billing", () => {
    expect(heuristicRoute("What is INV-2044 for?")?.agent).toBe("billing");
    expect(heuristicRoute("Status of REF-3007 please")?.agent).toBe("billing");
  });

  it("stands down when an order number appears in a billing complaint", () => {
    // The whole point of the guard: the noun is an order, the request is money.
    expect(heuristicRoute("I was charged twice for ORD-1023")).toBeNull();
    expect(heuristicRoute("I want a refund for ORD-1025")).toBeNull();
    expect(heuristicRoute("Send me the invoice for ORD-1021")).toBeNull();
  });

  it("stands down when both an order and a billing id are present", () => {
    expect(heuristicRoute("INV-2043 does not match ORD-1023")).toBeNull();
  });

  it("returns null for ordinary prose so the classifier decides", () => {
    expect(heuristicRoute("how do I reset my password")).toBeNull();
    expect(heuristicRoute("where is my order")).toBeNull();
  });
});

describe("routeMessage", () => {
  const base = { recentTurns: [], lastAgentType: null };

  it("short-circuits the model entirely when the heuristic fires", async () => {
    const decision = await routeMessage({ message: "track ORD-1023", ...base });

    expect(decision.agent).toBe("order");
    expect(decision.source).toBe("heuristic");
    expect(decision.isFallback).toBe(false);
    // The cost and latency claim the fast path is justified by, asserted.
    expect(stub.calls).toHaveLength(0);
  });

  it("uses the classifier's decision when it is confident", async () => {
    classifierReturns({ agent: "billing", intent: "billing_refund", confidence: 0.92 });

    const decision = await routeMessage({ message: "where is my money", ...base });

    expect(decision.agent).toBe("billing");
    expect(decision.source).toBe("llm");
    expect(decision.isFallback).toBe(false);
  });

  it("falls back to support when confidence is below the threshold", async () => {
    classifierReturns({ agent: "billing", intent: "billing_refund", confidence: 0.31 });

    const decision = await routeMessage({ message: "hmm", ...base });

    expect(decision.agent).toBe("support");
    expect(decision.source).toBe("fallback");
    expect(decision.isFallback).toBe(true);
    expect(decision.intent).toBe("unknown");
  });

  it("falls back when the classifier returns the unknown intent, however confident", async () => {
    classifierReturns({ agent: "order", intent: "unknown", confidence: 0.99 });

    const decision = await routeMessage({ message: "asdkjhasd", ...base });

    expect(decision.isFallback).toBe(true);
    expect(decision.agent).toBe("support");
  });

  it("degrades to the generalist instead of throwing when the provider fails", async () => {
    stub.impl = () => {
      throw new Error("503 model overloaded");
    };

    const decision = await routeMessage({ message: "help me", ...base });

    // A dead router must not take the conversation down with it.
    expect(decision.agent).toBe("support");
    expect(decision.source).toBe("fallback");
    expect(decision.confidence).toBe(0);
    expect(decision.reasoning).toContain("Router unavailable");
  });

  it("passes prior turns to the classifier so follow-ups can be resolved", async () => {
    classifierReturns({ agent: "order", intent: "order_tracking", confidence: 0.85 });

    await routeMessage({
      message: "when will it get here?",
      recentTurns: [
        { role: "user", content: "Where is ORD-1023?" },
        { role: "assistant", content: "It is in transit.", agentType: "order" },
      ],
      lastAgentType: "order",
    });

    // Without this the second turn of every conversation routes blind.
    const prompt = stub.calls[0]?.prompt ?? "";
    expect(prompt).toContain("ORD-1023");
    expect(prompt).toContain("previous turn was handled by the order agent");
  });
});
