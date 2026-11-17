/**
 * Provider-neutral conversation types. The tool loop (src/server/services/assistant.ts)
 * and the tools only see these; each provider adapter translates them to its API.
 * Swapping the LLM provider means writing one adapter, not touching business code.
 */

export type ChatBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: string; isError: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ChatBlock[];
  /**
   * The provider's own representation of an assistant turn (e.g. thinking blocks),
   * replayed verbatim to the same provider within one question. Never persisted.
   */
  providerContent?: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments (type: object). */
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  /** Identical for every user and request (cacheable). */
  systemStable: string;
  /** Per-request context: today's date, the user's role and scope. */
  systemContext: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CompletionResult {
  content: ChatBlock[];
  providerContent?: unknown;
  stopReason: StopReason;
  usage: Usage;
  /** Model that produced the answer (may differ from the requested one after a fallback). */
  model: string;
}

export type ProviderErrorKind = "unavailable" | "rate_limited" | "auth" | "bad_request" | "timeout";

/** Provider failures, normalised; messages are safe to show (no keys, no raw upstream bodies). */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
