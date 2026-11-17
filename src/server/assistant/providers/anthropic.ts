import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AssistantConfig } from "../config";
import { ProviderError, type ChatBlock, type ChatMessage, type CompletionRequest, type CompletionResult, type LlmProvider, type StopReason } from "../types";

type Param = Anthropic.Beta.BetaMessageParam;

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/**
 * Claude through the official Anthropic TypeScript SDK (Messages API, server-side only).
 * - The API key comes from ANTHROPIC_API_KEY on the server; it never reaches the browser.
 * - Tool definitions and the stable system prompt carry cache breakpoints, so repeated
 *   questions pay the cache-read rate for them.
 * - Thinking runs adaptively (the default on Claude Opus 5.5); depth is set with
 *   `output_config.effort`. Assistant turns are replayed unchanged within a question,
 *   thinking blocks included.
 * - A policy refusal is retried by the API on a fallback model (`fallbacks: "default"`).
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  /** `clientOptions` exists for tests (a fake `fetch`, no retries); production passes nothing. */
  constructor(
    private cfg: AssistantConfig,
    clientOptions: ConstructorParameters<typeof Anthropic>[0] = {},
  ) {
    // The SDK retries 408/409/429/5xx and connection errors twice with backoff.
    this.client = new Anthropic({ timeout: cfg.providerTimeoutMs, maxRetries: 2, ...clientOptions });
  }

  get model() {
    return this.cfg.model;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      ...(i === req.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    const fallback = this.cfg.fallbacks === "default" && FALLBACK_MODELS.has(this.cfg.model);
    try {
      const res = await this.client.beta.messages.create(
        {
          model: this.cfg.model,
          max_tokens: req.maxOutputTokens,
          system: [
            { type: "text", text: req.systemStable, cache_control: { type: "ephemeral" } },
            { type: "text", text: req.systemContext },
          ],
          tools,
          tool_choice: { type: "auto" },
          messages: req.messages.map(toParam),
          ...(this.cfg.effort ? { output_config: { effort: this.cfg.effort } } : {}),
          ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: req.signal },
      );
      return {
        content: res.content.flatMap((b): ChatBlock[] =>
          b.type === "text" ? [{ type: "text", text: b.text }] : b.type === "tool_use" ? [{ type: "tool_call", id: b.id, name: b.name, input: b.input }] : [],
        ),
        providerContent: res.content,
        stopReason: stopReason(res.stop_reason),
        usage: {
          inputTokens: res.usage.input_tokens ?? 0,
          outputTokens: res.usage.output_tokens ?? 0,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        },
        model: res.model,
      };
    } catch (e) {
      throw normalise(e);
    }
  }
}

function toParam(m: ChatMessage): Param {
  if (m.role === "assistant" && m.providerContent) {
    return { role: "assistant", content: m.providerContent as Anthropic.Beta.BetaContentBlockParam[] };
  }
  return {
    role: m.role,
    content: m.content.map((b): Anthropic.Beta.BetaContentBlockParam => {
      switch (b.type) {
        case "text":
          return { type: "text", text: b.text };
        case "tool_call":
          return { type: "tool_use", id: b.id, name: b.name, input: b.input as Record<string, unknown> };
        case "tool_result":
          return { type: "tool_result", tool_use_id: b.id, content: b.content, is_error: b.isError };
      }
    }),
  };
}

function stopReason(r: string | null): StopReason {
  return r === "end_turn" || r === "tool_use" || r === "max_tokens" || r === "refusal" ? r : r === "stop_sequence" ? "end_turn" : "other";
}

/** Typed SDK errors → safe, provider-neutral errors (most specific first). */
function normalise(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.APIUserAbortError || e instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("timeout", "The AI service took too long to answer.");
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("auth", "The AI service rejected the server's credentials.");
  }
  if (e instanceof Anthropic.RateLimitError) return new ProviderError("rate_limited", "The AI service is busy. Try again in a minute.");
  if (e instanceof Anthropic.BadRequestError) return new ProviderError("bad_request", "The AI service could not process this request.");
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIError) {
    return new ProviderError("unavailable", "The AI service is unavailable right now.");
  }
  return new ProviderError("unavailable", "The AI service is unavailable right now.");
}
