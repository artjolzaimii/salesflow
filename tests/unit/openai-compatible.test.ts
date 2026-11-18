import { describe, expect, it } from "vitest";
import { assistantConfig } from "@/server/assistant/config";
import { OpenAICompatibleProvider } from "@/server/assistant/providers/openai-compatible";
import { toolSpecs } from "@/server/assistant/tools";
import { ProviderError, type CompletionRequest } from "@/server/assistant/types";
import { checkConfig } from "@/server/config-check";

/** OpenAI-compatible adapter (Groq and similar), over a fake transport: no network, no key. */
describe("OpenAI-compatible adapter", () => {
  const cfg = { ...assistantConfig(), provider: "openai-compatible" as const, baseUrl: "https://api.example.test/openai/v1/", apiKey: "test-key-123", model: "test-model" };
  const req = (messages: CompletionRequest["messages"] = [{ role: "user", content: [{ type: "text", text: "Which invoices are overdue?" }] }]): CompletionRequest => ({
    systemStable: "STABLE",
    systemContext: "Today is 2026-11-18",
    messages,
    tools: toolSpecs().slice(0, 2),
    maxOutputTokens: 4000,
    signal: new AbortController().signal,
  });
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("sends a Chat Completions request with function tools and maps a tool call", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wire JSON
    let sent: { url: string; headers: Headers; body: Record<string, any> } | undefined;
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return reply(200, {
        model: "test-model",
        choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_overdue_invoices", arguments: '{"limit":5}' } }] } }],
        usage: { prompt_tokens: 120, completion_tokens: 15, prompt_tokens_details: { cached_tokens: 100 } },
      });
    }) as typeof globalThis.fetch;
    const res = await new OpenAICompatibleProvider(cfg, fetch).complete(req());
    expect(sent!.url).toBe("https://api.example.test/openai/v1/chat/completions");
    expect(sent!.headers.get("authorization")).toBe("Bearer test-key-123");
    expect(sent!.body).toMatchObject({ model: "test-model", tool_choice: "auto", max_tokens: 4000 });
    expect(sent!.body.messages[0]).toEqual({ role: "system", content: "STABLE\n\nToday is 2026-11-18" });
    expect(sent!.body.tools[0]).toMatchObject({ type: "function", function: { name: expect.any(String), parameters: { type: "object" } } });
    expect(res).toEqual({
      content: [{ type: "tool_call", id: "call_1", name: "get_overdue_invoices", input: { limit: 5 } }],
      stopReason: "tool_use",
      usage: { inputTokens: 120, outputTokens: 15, cacheReadTokens: 100, cacheWriteTokens: 0 },
      model: "test-model",
    });
  });

  it("replays tool calls and results in the wire format", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wire JSON
    let body: Record<string, any> | undefined;
    const fetch = (async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return reply(200, { choices: [{ finish_reason: "stop", message: { content: "Two invoices are overdue." } }] });
    }) as typeof globalThis.fetch;
    const res = await new OpenAICompatibleProvider(cfg, fetch).complete(
      req([
        { role: "user", content: [{ type: "text", text: "Overdue?" }] },
        { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_call", id: "c1", name: "get_overdue_invoices", input: {} }] },
        { role: "user", content: [{ type: "tool_result", id: "c1", content: '{"rows":[]}', isError: false }, { type: "tool_result", id: "c2", content: "bad input", isError: true }] },
      ]),
    );
    expect(body!.messages.slice(1)).toEqual([
      { role: "user", content: "Overdue?" },
      { role: "assistant", content: "Checking.", tool_calls: [{ id: "c1", type: "function", function: { name: "get_overdue_invoices", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: '{"rows":[]}' },
      { role: "tool", tool_call_id: "c2", content: "Error: bad input" },
    ]);
    expect(res).toMatchObject({ content: [{ type: "text", text: "Two invoices are overdue." }], stopReason: "end_turn", model: "test-model" });
  });

  it("passes unparseable tool arguments on as text (tool validation rejects them)", async () => {
    const fetch = (async () => reply(200, { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "x", function: { name: "get_overdue_invoices", arguments: "{not json" } }] } }] })) as typeof globalThis.fetch;
    const res = await new OpenAICompatibleProvider(cfg, fetch).complete(req());
    expect(res.content).toEqual([{ type: "tool_call", id: "x", name: "get_overdue_invoices", input: "{not json" }]);
  });

  it("retries busy and failing upstreams, then maps errors without leaking the upstream body", async () => {
    let calls = 0;
    const flaky = (async () => (++calls < 3 ? reply(calls === 1 ? 429 : 503, { error: "upstream says sk-secret" }) : reply(200, { choices: [{ finish_reason: "stop", message: { content: "ok" } }] }))) as typeof globalThis.fetch;
    expect((await new OpenAICompatibleProvider(cfg, flaky, 1).complete(req())).content).toEqual([{ type: "text", text: "ok" }]);
    expect(calls).toBe(3);

    const cases: [number, string][] = [[401, "auth"], [429, "rate_limited"], [400, "bad_request"], [500, "unavailable"]];
    for (const [status, kind] of cases) {
      const f = (async () => reply(status, { error: { message: "echo of the request with sk-secret" } })) as typeof globalThis.fetch;
      const e = await new OpenAICompatibleProvider(cfg, f, 1).complete(req()).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e).toMatchObject({ kind });
      expect(String((e as Error).message)).not.toMatch(/sk-secret|echo/);
    }
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof globalThis.fetch;
    expect(await new OpenAICompatibleProvider(cfg, down, 1).complete(req()).catch((x: unknown) => x)).toMatchObject({ kind: "unavailable" });
  });

  it("times out with the request signal", async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as typeof globalThis.fetch;
    const ctrl = new AbortController();
    const p = new OpenAICompatibleProvider(cfg, hang, 1).complete({ ...req(), signal: ctrl.signal });
    ctrl.abort();
    expect(await p.catch((x: unknown) => x)).toMatchObject({ kind: "timeout" });
  });
});

describe("assistant provider configuration", () => {
  const BASE = {
    DATABASE_URL: "postgresql://app:x@db.example:5432/s?sslmode=require",
    AUTH_SECRET: "k".repeat(44),
    AUTH_URL: "https://sales.example.al",
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CLIENT_IP_HEADER: "x-real-ip",
  };

  it("requires an https endpoint, a key and a model for openai-compatible", () => {
    const groq = { ...BASE, ASSISTANT_PROVIDER: "openai-compatible", ASSISTANT_BASE_URL: "https://api.groq.com/openai/v1", ASSISTANT_API_KEY: "k", ASSISTANT_MODEL: "m" };
    const ok = checkConfig(groq);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings.join()).toMatch(/\$0/);
    expect(ok.warnings.join()).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(checkConfig({ ...groq, ASSISTANT_BASE_URL: "http://api.groq.com/openai/v1" }).errors.join()).toMatch(/https/);
    expect(checkConfig({ ...groq, ASSISTANT_API_KEY: undefined }).errors.join()).toMatch(/ASSISTANT_API_KEY/);
    expect(checkConfig({ ...groq, ASSISTANT_MODEL: undefined }).errors.join()).toMatch(/ASSISTANT_MODEL/);
    expect(checkConfig({ ...BASE, ASSISTANT_PROVIDER: "openai" }).errors.join()).toMatch(/not supported/);
  });

  it("is configured only with endpoint, key and model; costs nothing unless priced", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { ASSISTANT_PROVIDER: "openai-compatible", ASSISTANT_BASE_URL: "https://api.groq.com/openai/v1", ASSISTANT_API_KEY: "k" });
      delete process.env.ASSISTANT_MODEL;
      expect(assistantConfig()).toMatchObject({ provider: "openai-compatible", apiKeyPresent: false, model: "" });
      process.env.ASSISTANT_MODEL = "m";
      expect(assistantConfig()).toMatchObject({ apiKeyPresent: true, apiKey: "k", customPrice: { input: 0, output: 0 } });
      process.env.ASSISTANT_PROVIDER = "anthropic";
      expect(assistantConfig().apiKey).toBe(""); // the generic key is never used for Claude
    } finally {
      for (const k of ["ASSISTANT_PROVIDER", "ASSISTANT_BASE_URL", "ASSISTANT_API_KEY", "ASSISTANT_MODEL"]) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
