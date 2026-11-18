import "server-only";
import type { AssistantConfig } from "../config";
import { ProviderError, type ChatBlock, type ChatMessage, type CompletionRequest, type CompletionResult, type LlmProvider, type StopReason } from "../types";

/**
 * Any model served through the OpenAI-compatible Chat Completions API
 * (`POST {ASSISTANT_BASE_URL}/chat/completions` with function tools): Groq,
 * Google Gemini's OpenAI endpoint, OpenRouter, a self-hosted server, …
 * - The key comes from ASSISTANT_API_KEY on the server; it never reaches the browser.
 * - Same contract as the Claude adapter: the tool loop, the read-only tools and
 *   every limit are unchanged; only the wire format differs.
 * - Retries 5xx and connection failures twice with backoff (like the Anthropic SDK).
 *   Rate limits (429) are waited out up to three times, as long as the provider's
 *   Retry-After is at most a minute: free tiers (Groq: 8,000 tokens per minute)
 *   often need a short pause between the rounds of one question. The whole
 *   question stays bounded by its own time limit.
 * - Tool schemas are sent compacted (no `$schema`, no regex `pattern` where a
 *   `format` says the same): about a third fewer tokens per round. Arguments are
 *   still validated in full by the tools' Zod schemas on the server.
 * - Upstream error bodies are never passed on (they can echo request data).
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible";
  private readonly url: string;

  /** `fetchImpl` and `retryDelayMs` exist for tests; production passes nothing. */
  constructor(
    private cfg: AssistantConfig,
    private fetchImpl: typeof fetch = fetch,
    private retryDelayMs = 1000,
  ) {
    this.url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  get model() {
    return this.cfg.model;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body = JSON.stringify({
      model: this.cfg.model,
      messages: [{ role: "system", content: `${req.systemStable}\n\n${req.systemContext}` }, ...req.messages.flatMap(toWire)],
      tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: compactSchema(t.inputSchema) } })),
      tool_choice: "auto",
      max_tokens: req.maxOutputTokens,
      temperature: 0.2,
    });
    const res = await this.post(body, req.signal);
    const choice = res.choices?.[0];
    if (!choice?.message) throw new ProviderError("unavailable", "The AI service returned an empty answer.");
    const msg = choice.message;
    const calls: ChatBlock[] = (msg.tool_calls ?? [])
      .filter((c) => c?.function?.name)
      .map((c, i) => ({ type: "tool_call", id: c.id || `call_${i}`, name: c.function.name, input: parseArguments(c.function.arguments) }));
    const text = typeof msg.content === "string" ? msg.content.trim() : "";
    return {
      content: [...(text ? [{ type: "text" as const, text }] : []), ...calls],
      stopReason: calls.length ? "tool_use" : stopReason(choice.finish_reason),
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        cacheReadTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
      model: res.model || this.cfg.model,
    };
  }

  private async post(body: string, signal: AbortSignal): Promise<WireResponse> {
    for (let attempt = 0; ; attempt++) {
      let status = 0;
      let retryAfterSec = 0;
      try {
        const res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.cfg.providerTimeoutMs)]),
        });
        if (res.ok) return (await res.json()) as WireResponse;
        status = res.status;
        retryAfterSec = Number(res.headers.get("retry-after")) || 0;
        await res.body?.cancel().catch(() => {});
      } catch (e) {
        if (signal.aborted || (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") {
          throw new ProviderError("timeout", "The AI service took too long to answer.");
        }
        status = -1; // connection failure
      }
      if (status === 429) {
        // Wait out a short rate limit (the provider says how long); give up on long ones.
        if (attempt >= 3 || retryAfterSec > MAX_RATE_LIMIT_WAIT_SEC) throw fromStatus(status);
        await sleep(retryAfterSec > 0 ? retryAfterSec * 1000 + 250 : this.retryDelayMs * 2 ** attempt, signal);
        continue;
      }
      const retryable = status === -1 || status >= 500;
      if (!retryable || attempt >= 2) throw fromStatus(status);
      await sleep(this.retryDelayMs * 2 ** attempt, signal);
    }
  }
}

/** Longest Retry-After (seconds) worth waiting for within one question. */
const MAX_RATE_LIMIT_WAIT_SEC = 60;

/** JSON Schema without parts the model doesn't need: `$schema`, and regex `pattern`s next to a `format`. */
export function compactSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compactSchema);
  if (!schema || typeof schema !== "object") return schema;
  const o = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "$schema" || (k === "pattern" && typeof o.format === "string")) continue;
    out[k] = compactSchema(v);
  }
  return out;
}

interface WireToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments?: string };
}
interface WireResponse {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; tool_calls?: WireToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/** One neutral message → one or more Chat Completions messages (tool results become role "tool"). */
function toWire(m: ChatMessage): Record<string, unknown>[] {
  const text = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  if (m.role === "assistant") {
    const calls = m.content.flatMap((b) => (b.type === "tool_call" ? [{ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []));
    return [{ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }];
  }
  const results = m.content.flatMap((b) => (b.type === "tool_result" ? [{ role: "tool", tool_call_id: b.id, content: b.isError ? `Error: ${b.content}` : b.content }] : []));
  return [...results, ...(text ? [{ role: "user", content: text }] : [])];
}

/** Tool arguments arrive as a JSON string; anything unparseable is passed on as-is and fails tool validation. */
function parseArguments(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function stopReason(r: string | null | undefined): StopReason {
  if (r === "stop") return "end_turn";
  if (r === "length") return "max_tokens";
  if (r === "content_filter") return "refusal";
  if (r === "tool_calls" || r === "function_call") return "tool_use";
  return "other";
}

function fromStatus(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("auth", "The AI service rejected the server's credentials.");
  if (status === 429) return new ProviderError("rate_limited", "The AI service is busy or its free quota is used up. Try again in a minute.");
  if (status === 400 || status === 404 || status === 413 || status === 422) return new ProviderError("bad_request", "The AI service could not process this request.");
  return new ProviderError("unavailable", "The AI service is unavailable right now.");
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new ProviderError("timeout", "The AI service took too long to answer."))), { once: true });
  });
}
