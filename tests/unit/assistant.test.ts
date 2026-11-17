import { describe, expect, it } from "vitest";
import { assistantConfig } from "@/server/assistant/config";
import { amountsIn, linkedRecords, unverifiedFigures } from "@/server/assistant/grounding";
import { AnthropicProvider } from "@/server/assistant/providers/anthropic";
import { serialize, toolSpecs } from "@/server/assistant/tools";
import { ProviderError, type CompletionRequest } from "@/server/assistant/types";

describe("grounding", () => {
  it("finds money-like amounts and checks them against tool results", () => {
    expect(amountsIn("Total 1,234,567.50 ALL and 47.68 EUR, 3 invoices, 12.5%")).toEqual(["1234567.50", "47.68"]);
    const results = [JSON.stringify({ net: "1234567.50", rows: [{ outstanding: "47.68" }] })];
    expect(unverifiedFigures("Sales were 1,234,567.50 ALL; 47.68 EUR is open.", results)).toEqual([]);
    expect(unverifiedFigures("Sales were 1,234,999.00 ALL.", results)).toEqual(["1234999.00"]);
    expect(unverifiedFigures("Sales were 10.00 ALL.", [])).toEqual(["10.00"]); // no tool ran: nothing is verified
  });

  it("links only records the answer names", () => {
    const recs = [
      { kind: "invoice" as const, id: "a", label: "INV-2026-002" },
      { kind: "invoice" as const, id: "b", label: "INV-2026-003" },
      { kind: "invoice" as const, id: "a", label: "INV-2026-002" },
    ];
    expect(linkedRecords("INV-2026-002 is overdue.", recs)).toEqual([recs[0]]);
  });
});

describe("tool results", () => {
  it("are trimmed to the size limit by shortening lists, and say so", () => {
    const big = { total: "1.00", rows: Array.from({ length: 500 }, (_, i) => ({ invoiceNumber: `INV-2026-${String(i).padStart(6, "0")}`, outstanding: "10.00" })) };
    const { text, truncated } = serialize(big, 2000);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2000);
    const parsed = JSON.parse(text);
    expect(parsed.truncated).toMatch(/shortened/);
    expect(parsed.data.total).toBe("1.00");
    expect(serialize({ a: 1 }, 2000)).toEqual({ text: '{"a":1}', truncated: false });
  });

  it("have JSON Schemas generated from the Zod schemas", () => {
    const top = toolSpecs().find((t) => t.name === "get_top_customers")!;
    expect(top.inputSchema).toMatchObject({ type: "object", properties: { period: { enum: ["today", "week", "month", "year", "custom"] }, limit: { maximum: 20 } } });
  });
});

describe("Anthropic adapter (official SDK, fake transport)", () => {
  const cfg = { ...assistantConfig(), model: "claude-opus-5-5", effort: "medium" as const, fallbacks: "default" as const };
  const req = (): CompletionRequest => ({
    systemStable: "STABLE",
    systemContext: "Today is 2026-11-17",
    messages: [{ role: "user", content: [{ type: "text", text: "Which invoices are overdue?" }] }],
    tools: toolSpecs().slice(0, 2),
    maxOutputTokens: 4000,
    signal: new AbortController().signal,
  });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends a cacheable, bounded request and maps the reply", async () => {
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return reply(200, {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "Checking." },
          { type: "tool_use", id: "toolu_1", name: "get_overdue_invoices", input: { limit: 5 } },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
      });
    };
    const provider = new AnthropicProvider(cfg, { apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
    const res = await provider.complete(req());
    expect(sent!.url).toContain("/v1/messages");
    expect(sent!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(sent!.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      tool_choice: { type: "auto" },
      output_config: { effort: "medium" },
      fallbacks: "default",
      system: [{ type: "text", text: "STABLE", cache_control: { type: "ephemeral" } }, { type: "text", text: "Today is 2026-11-17" }],
    });
    expect(sent!.body).not.toHaveProperty("temperature");
    const tools = sent!.body.tools as { cache_control?: unknown }[];
    expect(tools.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(res).toMatchObject({
      stopReason: "tool_use",
      content: [{ type: "text", text: "Checking." }, { type: "tool_call", id: "toolu_1", name: "get_overdue_invoices", input: { limit: 5 } }],
      usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 900 },
    });
    // The thinking block is kept for verbatim replay within the question.
    expect((res.providerContent as { type: string }[])[0].type).toBe("thinking");
  });

  it("sends no fallback (and no beta header) when the fallback is off, the default", async () => {
    let headers: Headers | undefined;
    let body: Record<string, unknown> = {};
    const fetch = async (_u: string | URL | Request, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      return reply(200, { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    };
    const provider = new AnthropicProvider({ ...cfg, fallbacks: "off" }, { apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
    await provider.complete(req());
    expect(body).not.toHaveProperty("fallbacks");
    expect(headers!.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });

  it("turns outages, rate limits and bad credentials into safe provider errors", async () => {
    const cases: [number, string][] = [
      [529, "unavailable"],
      [500, "unavailable"],
      [429, "rate_limited"],
      [401, "auth"],
      [400, "bad_request"],
    ];
    for (const [status, kind] of cases) {
      const fetch = async () => reply(status, { type: "error", error: { type: "x", message: "upstream detail sk-ant-secret" } });
      const provider = new AnthropicProvider(cfg, { apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
      const err = await provider.complete(req()).catch((e) => e);
      expect(err, String(status)).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
      expect(err.message).not.toContain("sk-ant");
    }
    const down = new AnthropicProvider(cfg, {
      apiKey: "test-key",
      maxRetries: 0,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch,
    });
    expect((await down.complete(req()).catch((e) => e)).kind).toBe("unavailable");
  });
});
