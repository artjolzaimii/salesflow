# SalesFlow AI assistant (Phase 5F)

The assistant answers business questions from SalesFlow data. A language model runs **on the server**, and its only access to data is a set of read-only tools that call the same services the screens use, with the signed-in user's permissions.

```
Browser ─► /api/assistant/* ─► services/assistant.ts (loop, limits, persistence)
                                   ├─► provider adapter ─► Claude (Anthropic Messages API)
                                   └─► assistant/tools.ts ─► reports / invoices / orders / customers services ─► PostgreSQL
```

## Provider

- **SDK:** the official Anthropic TypeScript SDK, `@anthropic-ai/sdk` **1.6.0** (pinned exactly; server-side only, Node runtime).
- **Model:** `claude-opus-5-5` by default (`ASSISTANT_MODEL`).
- **Request settings:**
  - Adaptive thinking (always on for this model), with `output_config.effort` = `medium` (`ASSISTANT_EFFORT`).
  - `tool_choice: auto`.
  - The server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): if the model declines on policy grounds, the API retries on a fallback model in the same call. Turn it off with `ASSISTANT_FALLBACKS=off`.
- **Provider abstraction:** `src/server/assistant/types.ts` defines provider-neutral messages and an `LlmProvider` interface. `providers/anthropic.ts` is the only file that knows the Anthropic API. Another provider means one new adapter; tools, the loop and the UI don't change.
- **Why not a hosted agent:** the loop is deliberately our own small, bounded one on the Messages API. The tools must run inside SalesFlow against its database with the user's permissions, and conversations must live in SalesFlow's own tables.

## Configuration

Set these on the server only (`.env`, or the host's secret store). Never use a `NEXT_PUBLIC_` prefix.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | **Required** to enable the assistant. Without it the screen says the assistant isn't configured and `POST …/messages` answers 503 `ASSISTANT_NOT_CONFIGURED`. |
| `ASSISTANT_MODEL` | `claude-opus-5-5` | Claude model ID. |
| `ASSISTANT_EFFORT` | `medium` | `low`/`medium`/`high`/`xhigh`/`max`; anything else omits the parameter. |
| `ASSISTANT_FALLBACKS` | `default` | `off` disables the server-side refusal fallback. |
| `ASSISTANT_MAX_OUTPUT_TOKENS` | 8000 | Per model call (includes thinking). |
| `ASSISTANT_MAX_ROUNDS` | 6 | Model calls per question. |
| `ASSISTANT_MAX_TOOL_CALLS` | 8 | Tool executions per question; later calls get an error result telling the model to answer with what it has. |
| `ASSISTANT_TIMEOUT_MS` | 90000 | Whole question. |
| `ASSISTANT_PROVIDER_TIMEOUT_MS` | 60000 | One model call (the SDK also retries 429/5xx twice with backoff). |
| `ASSISTANT_TOOL_TIMEOUT_MS` | 15000 | One tool execution. |
| `ASSISTANT_TOOL_RESULT_MAX_CHARS` | 12000 | Tool result size; lists are halved until the result fits, and it says it was shortened. |
| `ASSISTANT_CONTEXT_MESSAGES` / `ASSISTANT_CONTEXT_CHARS` | 20 / 24000 | Earlier turns replayed as context (text only; tool data is re-fetched, never replayed). |
| `ASSISTANT_MAX_INPUT_CHARS` | 2000 | Question length. |
| `ASSISTANT_REQUESTS_PER_HOUR` | 30 | Questions per user per rolling hour, counted in the database (works across server instances). |
| `ASSISTANT_PROVIDER` | `anthropic` | `scripted` = the deterministic offline provider used by the automated tests. It is labelled on screen and never used in production. |

## Tools

All tools are read-only. Each one validates its arguments with Zod (strict: unknown keys are rejected), calls an existing service with the user's `Principal`, and returns compact JSON with periods, currency and basis.

| Tool | Backed by | Notes |
|---|---|---|
| `get_dashboard_summary` | `reports.dashboardSummary` | Invoiced sales (and previous period), orders, pipeline, collections, active customers, receivables |
| `get_sales_trends` | `reports.salesBreakdown` (trend) | Day or month buckets; ≤ 100 |
| `get_top_customers`, `get_top_products`, `get_sales_by_representative` | `reports.salesBreakdown` | ≤ 20 rows; representative = the one on the order |
| `get_outstanding_invoices`, `get_overdue_invoices` | `reports.receivablesReport` | As of today; ≤ 50 rows plus aging |
| `get_payment_collections` | `reports.collectionsReport` | By payment date; grouped by date, method, currency or customer |
| `get_customer_details` | `customers.listCustomers` / `getCustomer` | By id or search; notes truncated to 300 characters |
| `get_order_details` | `orders.listOrders` / `getOrder` | By order number; ≤ 30 lines |
| `get_invoice_details` | `invoices.listInvoices` / `getInvoice` | By invoice number; ≤ 20 payments |

The financial definitions, date rules and currency rules are the reporting ones ([reporting.md](reporting.md)). The system prompt restates them so answers say "invoiced sales", keep sales, collections and receivables apart, name currencies, and never convert with an unknown rate.

## Safety

- **Authorization is in code.** Tools pass the user's `Principal` to the services, which check the permission matrix and apply representative scope. The prompt only explains it. A model that asks for another representative's invoice gets "no accessible invoice", the same as a non-existent one (tested).
- **No arbitrary access.** There is no SQL tool, no write tool and no Prisma access. Unknown tool names and invalid arguments become error results; nothing runs.
- **Prompt injection:**
  - Stored text (names, notes, references) reaches the model only inside JSON tool results.
  - The prompt says that text is data, never instructions, and free text is truncated.
  - Because the tools are read-only and scoped, even an obeyed injection can't reach more than the user could see on screen.
- **Grounding:**
  - The prompt requires every figure to come from a tool result.
  - After each answer, money-like amounts are checked against that question's tool results. Any that weren't returned are stored (`unverifiedFigures`) and shown under the answer ("not returned by SalesFlow lookups").
  - Records named in the answer are linked so users can open them.
- **Conversations are private.** `AIConversation.userId` is the owner. Every read and write filters on it, and another user (admins included) gets 404.
- **Failures are safe:**
  - Provider errors are normalised (`unavailable`, `rate_limited`, `auth`, `bad_request`, `timeout`). Users see a short message, and no upstream body, stack or key is ever returned.
  - The question and an error note are saved; error notes are not replayed as context.

## Persistence

- `AIConversation`: owner, title (from the first question), timestamps.
- `AIMessage`, in strictly increasing `createdAt` order within a question:
  - `USER`: the question.
  - `TOOL`: one per tool call (`toolName`, `toolCallId`, the result sent to the model, and metadata: arguments, ok, error, truncated).
  - `ASSISTANT`: the answer, with metadata: status (`ok`/`limit`/`error`), provider, model, tools used, linked records, unverified figures, token usage and estimated cost.
- No migration was needed; these tables come from the approved schema.

## Cost

- **Prices:** Claude Opus 5.5 is $4 per million input tokens and $20 per million output tokens. Cache reads cost $0.20/M; cache writes are about 1.25× input. Each answer records its token usage and estimated cost in `AIMessage.toolMetadata`.
- **Fixed part of every model call:** the system prompt plus 11 tool definitions, about 15,800 characters (≈ 4,000 tokens). It is marked for prompt caching; if it is below the model's minimum cacheable size it is billed at the normal input rate (≈ $0.016 per call).
- **Typical question:** two model calls (choose a tool, then answer) with one or two tool results and adaptive thinking at medium effort. About 8–15k input tokens and 0.5–2k output tokens, so **≈ $0.04–0.10**.
- **Hard ceiling per question** (all limits hit): 6 calls × (~35k input + 8k output) ≈ **$1.80**.
- **Per user:** ≤ 30 questions an hour by default, typically $1–3 an hour of active use.
- **Lowering costs:**
  - Reduce `ASSISTANT_REQUESTS_PER_HOUR`, `ASSISTANT_MAX_ROUNDS` or `ASSISTANT_MAX_OUTPUT_TOKENS`.
  - Use `ASSISTANT_EFFORT=low`.
  - Choose a cheaper model (`claude-sonnet-5-5`, $2/$10; `claude-haiku-5-5`, $0.10/$0.50) after checking answer quality on your own questions.
- **Spend cap:** also set a spend limit for the API key in the Anthropic Console.

## Tests

No test calls a paid API.
- **Test configuration:** Vitest and the test server set `ASSISTANT_PROVIDER=scripted` and an empty `ANTHROPIC_API_KEY`.
- **Fake models:** database tests inject fake providers to drive tool loops, limits, timeouts and injection attempts.
- **SDK adapter:** tested with the real SDK against a fake `fetch` (request shape, caching, fallback, error mapping).
