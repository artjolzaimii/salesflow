import { afterEach, describe, expect, it } from "vitest";
import { assistantConfig } from "@/server/assistant/config";
import { OpenAICompatibleProvider } from "@/server/assistant/providers/openai-compatible";
import { createConversation, sendMessage, setProviderForTests } from "@/server/services/assistant";
import { db, MANAGER, principalFor } from "../support/fixtures";

/** The real tool loop and tools, through the OpenAI-compatible adapter (fake endpoint, no network). */
describe("assistant over an OpenAI-compatible endpoint", () => {
  afterEach(() => {
    setProviderForTests(null);
    delete process.env.ASSISTANT_PROVIDER;
  });

  it("calls a database tool, answers, and is costed at $0 on a free tier", async () => {
    process.env.ASSISTANT_PROVIDER = "openai-compatible";
    type Wire = { messages: { role: string; tool_call_id?: string; content: string }[] };
    const bodies: Wire[] = [];
    const fetch = (async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const json = bodies.length === 1
        ? { model: "free-model", choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_a", type: "function", function: { name: "get_dashboard_summary", arguments: "{}" } }] } }], usage: { prompt_tokens: 900, completion_tokens: 20 } }
        : { model: "free-model", choices: [{ finish_reason: "stop", message: { content: "Here is the dashboard summary." } }], usage: { prompt_tokens: 1400, completion_tokens: 30 } };
      return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    const cfg = { ...assistantConfig(), provider: "openai-compatible" as const, baseUrl: "https://free.example.test/v1", apiKey: "k", model: "free-model" };
    setProviderForTests(new OpenAICompatibleProvider(cfg, fetch, 1));

    const m = await principalFor(MANAGER);
    const conversation = await createConversation(m, {});
    const result = await sendMessage(m, conversation.id, { content: "Give me the dashboard summary" });
    expect(result.assistantMessage).toMatchObject({ role: "assistant", status: "ok", tools: ["get_dashboard_summary"] });
    expect(bodies).toHaveLength(2);
    const toolMsg = bodies[1].messages.find((x) => x.role === "tool")!;
    expect(toolMsg).toMatchObject({ tool_call_id: "call_a" });
    expect(JSON.parse(toolMsg.content)).toBeTypeOf("object"); // real data from the database
    const answer = await db().aIMessage.findFirstOrThrow({ where: { conversationId: conversation.id, role: "ASSISTANT" } });
    expect(answer.toolMetadata).toMatchObject({ estimatedCostUsd: 0 });
  });
});
