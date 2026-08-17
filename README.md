# Northwind Support — Multi-Agent AI Customer Support

**Live demo:** https://support-agent-web-nu.vercel.app
**API:** https://support-agent-api-ten.vercel.app/health

A customer support system where a **router agent** classifies each incoming message and delegates it to one of three specialists — **Support**, **Order**, or **Billing** — each with its own tools backed by a real Postgres database.

Built with Hono, Drizzle, the Vercel AI SDK and React, in a Turborepo monorepo with end-to-end type safety via Hono RPC.

```
┌─────────────┐   POST /api/chat/messages   ┌──────────────────────────────────┐
│  React UI   │ ──────────────────────────► │        Router Agent              │
│  (Vite)     │ ◄────── SSE stream ──────── │  1. deterministic ID heuristic   │
└─────────────┘                             │  2. LLM classifier + context     │
      ▲                                     │  3. low-confidence → fallback    │
      │ typed via hc<AppType>               └───────────────┬──────────────────┘
      │                                                     │ delegates
      │                        ┌────────────────────────────┼────────────────────────────┐
      │                        ▼                            ▼                            ▼
      │                 ┌─────────────┐             ┌─────────────┐             ┌─────────────┐
      │                 │   Support   │             │    Order    │             │   Billing   │
      │                 ├─────────────┤             ├─────────────┤             ├─────────────┤
      │                 │ searchKB    │             │ getOrder    │             │ getInvoice  │
      │                 │ searchHist  │             │ listOrders  │             │ listInvoices│
      │                 │ snapshot    │             │ checkDeliv  │             │ listPayments│
      │                 └──────┬──────┘             │ cancelOrder │             │ checkRefund │
      │                        │                    └──────┬──────┘             │ getSubscript│
      │                        │                           │                    └──────┬──────┘
      │                        └───────────────┬───────────┴───────────────────────────┘
      │                                        ▼
      │                              ┌───────────────────┐
      └──── routing card, tool ──────│  Repositories     │
            chips, live status       │  → Postgres       │
                                     └───────────────────┘
```

---

## Setup

**Requires** Node ≥ 22, pnpm, a Postgres database (Neon works), and a Gemini API key.

```bash
pnpm install
cp .env.example .env      # fill in DATABASE_URL + GOOGLE_GENERATIVE_AI_API_KEY
pnpm db:push              # create tables
pnpm db:seed              # seed demo data
pnpm dev                  # API :3001, web :5173
```

Then open http://localhost:5173.

Seed data: one customer, 6 orders spanning every status, matching shipments with tracking events, 6 invoices, a genuine duplicate-charge scenario, an in-flight refund, a subscription, 11 knowledge-base articles, and **2 prior conversations** so cross-conversation history search returns real results on the first message.

### Things to try

| Message | Expected |
|---|---|
| `Where is my order ORD-1023?` | Order agent, heuristic tier, 0 LLM calls |
| `when will it get here?` | Still Order — pronoun resolved from context |
| `I think I was charged twice for it` | Re-routes to Billing, checks payments, **disagrees** if there's no duplicate |
| `Can you cancel ORD-1023?` | Refused — already shipped, offers returns |
| `Can you cancel ORD-1024?` | Allowed — still processing |
| `asdkjhasd` | Low confidence → fallback → clarifying question with real account options |

---

## What actually happens on one message

1. The user message is persisted immediately.
2. `contextService` loads the conversation, and compacts it into a rolling summary if it has outgrown the token budget.
3. The **router** classifies the message *together with the conversation context*.
4. The chosen sub-agent runs a tool loop against the database.
5. Routing decision, each tool call, and the answer stream to the client as it happens.
6. The assistant message — with its routing provenance and tool calls — is persisted before the response closes.

### The bit that matters

> **User:** Where is my order ORD-1023?
> → routed to **Order** in 1ms by the deterministic tier, *no LLM call at all*
>
> **User:** when will it get here?
> → still **Order**, 95% confidence, and the agent resolves `ORD-1023` from context
>
> **User:** I think I was charged twice for it
> → re-routed to **Billing**: *"a double charge overrides the previous order context"*

That second message contains no order number and no order vocabulary. It routes correctly because the router sees the conversation, not just the message. That is the whole point of the design.

---

## Multi-agent design

### Router — three tiers, in order

| Tier | Mechanism | When it fires |
|---|---|---|
| **1. Heuristic** | Regex on order/invoice/refund IDs | Exactly one domain's ID present, no competing vocabulary. Costs 0 tokens, ~1ms. |
| **2. LLM** | `generateText` + `Output.object`, `temperature: 0` | Everything else. Sees the rolling summary, the last turns, and which agent handled the previous turn. |
| **3. Fallback** | Support agent + clarification directive | Confidence < 0.5, intent `unknown`, or the classifier itself failed. |

The heuristic deliberately **stands down** when both signals are present — `"I was charged twice for ORD-1023"` contains an order number but is a billing question, so it defers to the classifier. There's a test for exactly this.

Tier 3 also catches provider failure: if the classifier throws, the router returns a fallback decision rather than propagating the error. A dead router degrades the answer; it doesn't kill the conversation.

### Sub-agents

Each is a `ToolLoopAgent` with scoped instructions, its own tools, and a step cap. All 12 tools query Postgres through the repository layer.

**Business rules live in code, not prompts.** `cancelOrder` refuses a shipped order and returns a structured refusal explaining why, which the agent turns into prose and an offer of the returns path. A prompt is a suggestion; this is a guarantee — and it holds even if the model is talked into trying.

### Tool security

`userId` is declared as tool **context**, not tool **input**:

```ts
getOrderDetails: tool({
  inputSchema: z.object({ orderNumber: orderNumberInput }),  // ← all the model sees
  contextSchema: toolContextSchema,                          // ← injected server-side
  execute: async ({ orderNumber }, { context }) =>
    orderRepository.findByNumber(context.userId, orderNumber),
})
```

The model has no parameter with which to request another customer's data. Compare the naive `getOrderDetails(userId, orderNumber)`, where a prompt injection is one hallucinated argument away from a data leak. There is a test asserting the exposed schema contains only `orderNumber`.

Because `toolsContext` is per-request, agents are constructed per-request.

---

## Context management

`contextService.build()` assembles the model-facing view of a conversation:

- Loads messages after the last **compaction checkpoint**.
- If the estimated tokens exceed `CONTEXT_TOKEN_BUDGET`, summarises everything older than the last `CONTEXT_KEEP_RECENT_MESSAGES` turns and stores it with the id of the last message it covers.
- Compaction is therefore **incremental and idempotent** — one cheap call each time the window fills, not a re-summary of the whole history on every turn.

The compaction prompt is tuned for support specifically: preserve every order/invoice/refund number and every commitment made. A summary that loses `ORD-1023` makes the next *"where is it?"* unanswerable.

Verified working: with the budget forced low, a turn emitted `compacted: true, summarisedMessages: 5, messagesInWindow: 2`, and the agent still correctly recalled the order number, the amount and the renewal date — from the summary alone.

---

## Architecture

Strict **Route → Controller → Service → Repository**. Repositories are the only code that imports Drizzle; agent tools call repositories, which is what keeps the agent layer unit-testable without a database.

```
apps/api/src/
  app.ts                 # composition root, exports AppType for RPC
  routes/                # thin, chained (the chain is what RPC infers from)
  controllers/           # HTTP-agnostic: validated input in, payload out
  services/
    orchestrator.service.ts   # route → delegate → stream → persist
    context.service.ts        # history window + compaction
    conversation.service.ts
  agents/
    router.agent.ts, subagents.ts, registry.ts, provider.ts
    tools/                    # order, billing, support + labels, context
  repositories/          # the only Drizzle importers
  middleware/            # error handler, rate limit, validation, request id
  lib/errors.ts          # AppError hierarchy
```

`agents/registry.ts` is a single source of truth: it drives the `/api/agents` endpoints, the routing menu injected into the router's prompt, and the badge colours in the UI. Adding a fourth agent means editing that file and registering a runner.

### Error handling

Every deliberate failure extends `AppError`; one `app.onError` middleware turns it into a single envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "...", "requestId": "..." } }
```

Anything that isn't an `AppError` is logged in full and reported as a generic 500 — unhandled error messages leak connection strings and SQL.

Once the stream has opened, an HTTP status is no longer available, so mid-stream failures travel as a `data-error` stream part instead, mapped through `normaliseProviderError` so the client is told *"the provider is rate limiting us, wait a moment"* rather than *"an error occurred"*.

### Provider abstraction + automatic fallback

Models are selected by **role** (`router` / `agent` / `summary`), never by name at the call site. The provider is one env var: `google`, `openai`, `openrouter`, or Vercel AI Gateway.

On top of that, `withFallback` wraps the primary model in AI SDK middleware. If a call fails with a *retryable* error — quota, rate limit, model retired — it transparently retries against a second provider. Implemented as middleware so the router, all three sub-agents and the summariser inherit it without a line of failover logic between them.

This is not theoretical: Gemini's free tier is ~20 requests/day/model, and one turn costs two.

---

## API

```
POST   /api/chat/messages                # send message, SSE stream back
GET    /api/chat/conversations           # list
GET    /api/chat/conversations/:id       # full history
DELETE /api/chat/conversations/:id       # delete (cascades)
GET    /api/agents                       # available agents
GET    /api/agents/:type/capabilities    # agent capabilities + tools
GET    /health                           # liveness + DB + model config
```

The client sends only the **new message**, never the transcript — the server owns history, because context assembly, compaction and the router's brief all read from the database. Trusting a client transcript would let the two views silently diverge.

### Custom stream parts

Alongside the tokens, the orchestrator emits typed data parts: `data-conversation`, `data-status` (transient), `data-route`, `data-tool`, `data-context`, `data-error`. Tool events come from the real `onToolExecutionStart` / `onToolExecutionEnd` lifecycle hooks, so *"Fetching order ORD-1023"* reflects an actual call with actual arguments — not a decorative timer.

---

## Deployment

Two Vercel projects from this one repo:

| Project | Root | What it is |
|---|---|---|
| `support-agent-web` | `apps/web` | Static Vite build on the CDN |
| `support-agent-api` | `apps/api` | Hono running as a Vercel Function |
| database | — | Neon Postgres (unchanged from local) |

The frontend calls the API cross-origin, which is why `CORS_ORIGIN` and the
`exposeHeaders` list exist in `app.ts`.

**Why two projects rather than one domain with a proxy rewrite:** every SSE
stream would take an extra hop through the rewrite. Streaming is the feature
being demonstrated, so it goes browser → API directly.

### The API is bundled by tsup, not compiled by Vercel

The API project's build command is `pnpm run build`, which runs tsup and emits
a single `index.js`. Vercel serves that instead of compiling the TypeScript
itself.

Vercel's Node builder type-checks source with its own TypeScript version, older
than the 5.9.3 pinned here, and reported dozens of false errors against `ai@7`,
`zod@4` and Drizzle's conditional types — while `pnpm typecheck` passes clean
across all four packages. An explicit build command takes the platform's
toolchain out of the equation: tsup bundles with esbuild, which strips types
without checking them. `tsc` is still enforced, as its own `turbo` task on a
version we control.

### Deploying it yourself

```bash
vercel link --project <name>
vercel api -X PATCH /v9/projects/<id> -f rootDirectory=apps/api
vercel api -X PATCH /v9/projects/<id> -f buildCommand="pnpm run build"
vercel env add DATABASE_URL production        # + the AI keys
vercel deploy --prod
```

`rootDirectory` and `buildCommand` are project settings, not `vercel.json` keys.

---

## Tests

```bash
pnpm test    # 32 tests
```

- **Router** — heuristic precision, the stand-down cases, threshold fallback, unknown-intent fallback, provider-failure degradation, and that prior turns actually reach the classifier.
- **Tools** — `cancelOrder` refuses all four terminal statuses and never writes; tenant scoping; the model-visible schema contains no `userId`.
- **Middleware** — sliding-window rate limiting (including that the window slides rather than resetting in blocks), per-caller isolation, the error envelope, validation.

---

## Bonuses implemented

- **Turborepo monorepo + Hono RPC** — `hc<AppType>` gives the frontend compile-time knowledge of every route, param and response shape. No codegen, no OpenAPI document.
- **Streaming** with custom typed data parts.
- **Live agent activity** — real tool labels, not a fake spinner.
- **Visible reasoning** — expandable routing card showing intent, confidence, and which tier decided.
- **Context compaction** with an incremental checkpoint.
- **Rate limiting** — sliding window, `429` + `Retry-After` + `X-RateLimit-*`.
- **Tests** — 32.
- **Provider fallback** across two providers.
- **Deployed live demo** — links at the top.

---

## Tradeoffs, honestly

- **Rate limiting is in-process.** Correct for one instance; behind N instances the effective limit is N×. Swapping in Redis means replacing the `buckets` map — the middleware around it is unchanged.
- **No authentication.** "The current user" resolves to the seeded customer in one middleware. Every layer below already reads identity from the request context, which is exactly where a real session would put it.
- **Knowledge-base search is ILIKE**, not full-text. Honest at seed scale; moving to Postgres FTS is a repository-local change.
- **Token estimation is `length / 4`**, not a real tokenizer. It only decides *when* to compact; being 10% off moves the threshold slightly and nothing else.
- **One type erasure**, in `subagents.ts`. `ToolLoopAgent` is invariant in its tool set, so three agents with three tool maps have three incompatible types. The orchestrator only reads streamed parts and lifecycle events, never a tool-specific type, so widening there is safe — and it's isolated to a single documented function.

## What I'd do next

Human escalation with ticket creation; agent-to-agent handoff within one turn (the Billing agent noticing it needs order data); Postgres FTS for the knowledge base; per-agent evals to catch routing regressions; and moving conversation writes into a transaction once the driver supports it on the pooled endpoint.
