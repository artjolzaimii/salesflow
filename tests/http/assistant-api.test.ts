import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { ADMIN, MANAGER, REP_KORCE } from "../support/fixtures";
import { api, base, signIn } from "../support/http";

/** Assistant endpoints over HTTP. The test server runs the offline scripted provider (no paid API). */
describe.skipIf(!base)("assistant APIs over HTTP", () => {
  let manager: string, admin: string, korce: string;

  beforeAll(async () => {
    [manager, admin, korce] = (await Promise.all([MANAGER, ADMIN, REP_KORCE].map((e) => signIn(e, DEMO_PASSWORD)))) as string[];
  });

  const start = async (cookie: string) => (await (await api.post("/api/assistant/conversations", {}, cookie)).json()).conversation.id as string;

  it("answers 401 without a session", async () => {
    const id = crypto.randomUUID();
    for (const path of ["/api/assistant", "/api/assistant/conversations", `/api/assistant/conversations/${id}`]) expect((await api.get(path)).status, path).toBe(401);
    expect((await api.post("/api/assistant/conversations", {})).status).toBe(401);
    expect((await api.post(`/api/assistant/conversations/${id}/messages`, { content: "hi" })).status).toBe(401);
  });

  it("reports status without exposing credentials", async () => {
    const res = await (await api.get("/api/assistant", manager)).json();
    expect(res).toMatchObject({ configured: true, provider: "scripted", offlineTestProvider: true, maxInputChars: 2000 });
    expect(JSON.stringify(res)).not.toMatch(/key|secret|sk-ant/i);
  });

  it("creates, answers from real data, persists and lists a conversation", async () => {
    const id = await start(manager);
    const res = await api.post(`/api/assistant/conversations/${id}/messages`, { content: "What is the status of INV-2026-002?", grandTotal: "1" }, manager);
    expect(res.status).toBe(422); // strict body: only `content`
    const ok = await api.post(`/api/assistant/conversations/${id}/messages`, { content: "What is the status of INV-2026-002?" }, manager);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.userMessage).toMatchObject({ role: "user", content: "What is the status of INV-2026-002?" });
    expect(body.assistantMessage).toMatchObject({ role: "assistant", status: "ok", tools: ["get_invoice_details"], unverifiedFigures: [] });
    expect(body.assistantMessage.content).toContain("47.68 EUR");
    expect(body.assistantMessage.records[0]).toMatchObject({ kind: "invoice", label: "INV-2026-002", id: expect.any(String) });
    const conv = (await (await api.get(`/api/assistant/conversations/${id}`, manager)).json()).conversation;
    expect(conv.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    const list = (await (await api.get("/api/assistant/conversations", manager)).json()).items;
    expect(list[0]).toMatchObject({ id, title: "What is the status of INV-2026-002?", messageCount: 2 });
  });

  it("keeps conversations private and data scoped", async () => {
    const id = await start(manager);
    expect((await api.get(`/api/assistant/conversations/${id}`, admin)).status).toBe(404);
    expect((await api.post(`/api/assistant/conversations/${id}/messages`, { content: "hello" }, admin)).status).toBe(404);
    expect(((await (await api.get("/api/assistant/conversations?pageSize=100", admin)).json()).items as { id: string }[]).map((c) => c.id)).not.toContain(id);
    const repConv = await start(korce);
    const answer = await (await api.post(`/api/assistant/conversations/${repConv}/messages`, { content: "What is the status of INV-2026-001?" }, korce)).json();
    expect(answer.assistantMessage.content).toContain("No accessible invoice numbered INV-2026-001");
    expect(answer.assistantMessage.records).toEqual([]);
  });

  it("validates input and reports provider failures safely", async () => {
    const id = await start(manager);
    expect((await api.post(`/api/assistant/conversations/${id}/messages`, { content: "   " }, manager)).status).toBe(422);
    expect((await api.post(`/api/assistant/conversations/${id}/messages`, { content: "x".repeat(2001) }, manager)).status).toBe(422);
    const text = await fetch(base + `/api/assistant/conversations/${id}/messages`, { method: "POST", headers: { cookie: manager, "content-type": "text/plain" }, body: "hi" });
    expect(text.status).toBe(415);
    const down = await api.post(`/api/assistant/conversations/${id}/messages`, { content: "[provider-down] sales?" }, manager);
    expect(down.status).toBe(503);
    const err = (await down.json()).error;
    expect(err.code).toBe("ASSISTANT_UNAVAILABLE");
    expect(JSON.stringify(err)).not.toMatch(/stack|prisma|sk-ant/i);
    expect((await api.get("/api/assistant/conversations/not-a-uuid", manager)).status).toBe(404);
  });
});
