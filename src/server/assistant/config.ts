import "server-only";

/**
 * Assistant configuration, from server-side environment variables only (never
 * NEXT_PUBLIC_*). Every limit has a safe default; see docs/assistant.md.
 */
const int = (name: string, fallback: number, min: number, max: number) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const num = (name: string, fallback: number, min: number, max: number) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export function assistantConfig() {
  const effort = process.env.ASSISTANT_EFFORT ?? "medium";
  return {
    /** "anthropic" (default) or "scripted" (deterministic offline provider for automated tests). */
    provider: (process.env.ASSISTANT_PROVIDER || "anthropic") as "anthropic" | "scripted",
    apiKeyPresent: !!process.env.ANTHROPIC_API_KEY,
    model: process.env.ASSISTANT_MODEL || "claude-opus-5-5",
    /** "" disables the effort parameter (for models that don't accept it). */
    effort: (EFFORTS as readonly string[]).includes(effort) ? (effort as Effort) : null,
    /**
     * Server-side refusal fallback (another model answers when the configured one declines).
     * Off unless explicitly approved with ASSISTANT_FALLBACKS=default: a fallback silently
     * changes the model (and cost) that answers financial questions.
     */
    fallbacks: process.env.ASSISTANT_FALLBACKS === "default" ? ("default" as const) : ("off" as const),
    maxOutputTokens: int("ASSISTANT_MAX_OUTPUT_TOKENS", 8000, 512, 32000),
    /** Model calls per question (each may request tools). */
    maxRounds: int("ASSISTANT_MAX_ROUNDS", 6, 1, 12),
    /** Tool executions per question; further calls get an error result. */
    maxToolCalls: int("ASSISTANT_MAX_TOOL_CALLS", 8, 1, 30),
    /** Whole question, all rounds and tools included. */
    requestTimeoutMs: int("ASSISTANT_TIMEOUT_MS", 90_000, 5_000, 600_000),
    /** One model call. */
    providerTimeoutMs: int("ASSISTANT_PROVIDER_TIMEOUT_MS", 60_000, 2_000, 600_000),
    /** One tool execution. */
    toolTimeoutMs: int("ASSISTANT_TOOL_TIMEOUT_MS", 15_000, 500, 120_000),
    /** Serialized tool result sent to the model; larger results are trimmed. */
    toolResultMaxChars: int("ASSISTANT_TOOL_RESULT_MAX_CHARS", 12_000, 1_000, 100_000),
    /** Earlier conversation turns replayed to the model. */
    contextMessages: int("ASSISTANT_CONTEXT_MESSAGES", 20, 0, 100),
    contextChars: int("ASSISTANT_CONTEXT_CHARS", 24_000, 1_000, 400_000),
    maxInputChars: int("ASSISTANT_MAX_INPUT_CHARS", 2_000, 100, 20_000),
    /** Questions per user per rolling hour (counted in the database). */
    requestsPerHour: int("ASSISTANT_REQUESTS_PER_HOUR", 30, 1, 10_000),
    /** Questions being answered at once across all users and server instances. */
    maxConcurrent: int("ASSISTANT_MAX_CONCURRENT", 10, 1, 1_000),
    /** Estimated model spend caps over a rolling 24 hours (USD), from the usage stored with each answer. */
    dailyUsdPerUser: num("ASSISTANT_DAILY_USD_PER_USER", 5, 0.01, 10_000),
    dailyUsdTotal: num("ASSISTANT_DAILY_USD_TOTAL", 50, 0.01, 1_000_000),
  };
}

export type AssistantConfig = ReturnType<typeof assistantConfig>;

/** USD per million tokens for cost estimates and spend caps (docs/assistant.md). Unknown models are costed at the highest listed price. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
