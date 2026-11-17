import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { businessDate } from "@/lib/business-date";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { getDb } from "@/server/db";
import { AppError, conflict, notFound } from "@/server/errors";
import { logError } from "@/server/log";
import { paged } from "@/server/query";
import { assistantConfig, PRICES, type AssistantConfig } from "@/server/assistant/config";
import { linkedRecords, unverifiedFigures } from "@/server/assistant/grounding";
import { SYSTEM_PROMPT, systemContext } from "@/server/assistant/prompt";
import { AnthropicProvider } from "@/server/assistant/providers/anthropic";
import { ScriptedProvider } from "@/server/assistant/providers/scripted";
import { runTool, toolSpecs, type RecordRef } from "@/server/assistant/tools";
import { ProviderError, type ChatBlock, type ChatMessage, type LlmProvider, type Usage } from "@/server/assistant/types";

/**
 * AI assistant: conversations (AIConversation / AIMessage, owned by one user) and
 * the bounded tool loop. Route Handler → this service → provider adapter + tools →
 * reporting/business services → PostgreSQL.
 */

export const DEFAULT_TITLE = "New conversation";

export const conversationCreateSchema = z.strictObject({ title: z.string().trim().min(1).max(200).optional() });
export const messageSchema = z.strictObject({ content: z.string().trim().min(1, "Type a question.") });
export const conversationListQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

/* ------------------------------------------------------------ provider */

let override: LlmProvider | null = null;
/** Tests inject a fake provider; production chooses from the environment. */
export function setProviderForTests(p: LlmProvider | null) {
  override = p;
}

function providerFor(cfg: AssistantConfig): LlmProvider | null {
  if (override) return override;
  if (cfg.provider === "scripted") return new ScriptedProvider();
  return cfg.apiKeyPresent ? new AnthropicProvider(cfg) : null;
}

/** What the screen needs to know before the first question (no secrets). */
export function assistantStatus(p: Principal) {
  assertPermission(p, "assistant.use");
  const cfg = assistantConfig();
  const provider = providerFor(cfg);
  return {
    configured: !!provider,
    provider: provider?.name ?? null,
    offlineTestProvider: provider?.name === "scripted",
    maxInputChars: cfg.maxInputChars,
    requestsPerHour: cfg.requestsPerHour,
  };
}

/* ------------------------------------------------------- conversations */

const own = (p: Principal, id: string): Prisma.AIConversationWhereInput => ({ id, userId: p.userId });

export async function listConversations(p: Principal, q: z.output<typeof conversationListQuery> = conversationListQuery.parse({})) {
  assertPermission(p, "assistant.use");
  const db = getDb();
  const where = { userId: p.userId };
  const [rows, total] = await db.$transaction([
    db.aIConversation.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: { where: { role: { in: ["USER", "ASSISTANT"] } } } } } },
    }),
    db.aIConversation.count({ where }),
  ]);
  return paged(
    rows.map((c) => ({ id: c.id, title: c.title ?? DEFAULT_TITLE, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c._count.messages })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function createConversation(p: Principal, input: z.output<typeof conversationCreateSchema>) {
  assertPermission(p, "assistant.use");
  const c = await getDb().aIConversation.create({ data: { userId: p.userId, title: input.title ?? DEFAULT_TITLE } });
  return { id: c.id, title: c.title ?? DEFAULT_TITLE, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: 0 };
}

type StoredMessage = { id: string; role: "SYSTEM" | "USER" | "ASSISTANT" | "TOOL"; content: string; toolName: string | null; toolMetadata: Prisma.JsonValue; createdAt: Date };

function messageDto(m: StoredMessage) {
  const meta = (m.toolMetadata ?? {}) as Record<string, unknown>;
  return {
    id: m.id,
    role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
    content: m.content,
    createdAt: m.createdAt,
    status: (meta.status as "ok" | "error" | "limit" | undefined) ?? "ok",
    tools: (meta.tools as string[] | undefined) ?? [],
    records: (meta.records as RecordRef[] | undefined) ?? [],
    unverifiedFigures: (meta.unverifiedFigures as string[] | undefined) ?? [],
    model: (meta.model as string | undefined) ?? null,
  };
}

/** A conversation and its user/assistant messages in order. Other users' conversations are 404. */
export async function getConversation(p: Principal, id: string) {
  assertPermission(p, "assistant.use");
  const c = await getDb().aIConversation.findFirst({
    where: own(p, id),
    include: { messages: { where: { role: { in: ["USER", "ASSISTANT"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!c) throw notFound("Conversation");
  return { id: c.id, title: c.title ?? DEFAULT_TITLE, createdAt: c.createdAt, updatedAt: c.updatedAt, messages: c.messages.map(messageDto) };
}

/* ------------------------------------------------------------ the loop */

/** pg_advisory_xact_lock key serializing assistant admission (short: checks + one insert). */
const ADMISSION_LOCK = 0x5f0002;

/** Earlier turns for context: user questions and successful answers only (no tool data), newest within budget. */
async function history(conversationId: string, cfg: AssistantConfig): Promise<ChatMessage[]> {
  if (!cfg.contextMessages) return [];
  const rows = await getDb().aIMessage.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: cfg.contextMessages,
    select: { role: true, content: true, toolMetadata: true },
  });
  const out: ChatMessage[] = [];
  let chars = 0;
  for (const r of rows) {
    const status = (r.toolMetadata as { status?: string } | null)?.status;
    if (r.role === "ASSISTANT" && status && status !== "ok") continue;
    chars += r.content.length;
    if (chars > cfg.contextChars) break;
    out.unshift({ role: r.role === "USER" ? "user" : "assistant", content: [{ type: "text", text: r.content }] });
  }
  // The model expects user/assistant alternation starting with a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  const merged: ChatMessage[] = [];
  for (const m of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content.push(...m.content);
    else merged.push(m);
  }
  if (merged.length && merged[merged.length - 1].role === "user") merged.pop(); // an unanswered question
  return merged;
}

const MAX_PRICE = Object.values(PRICES).reduce((m, p) => (p.output > m.output ? p : m));

function costUsd(model: string, u: Usage): number {
  const price = PRICES[model] ?? MAX_PRICE;
  const usd = (u.inputTokens * price.input + u.outputTokens * price.output + u.cacheReadTokens * price.cacheRead + u.cacheWriteTokens * price.cacheWrite) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Answers one question. Bounded by: maxRounds model calls, maxToolCalls tool
 * executions, a per-tool timeout, a whole-request timeout, result-size limits,
 * and the admission checks below (all enforced in the database, so they hold
 * across server instances).
 */
export async function sendMessage(p: Principal, conversationId: string, raw: z.output<typeof messageSchema>) {
  assertPermission(p, "assistant.use");
  const cfg = assistantConfig();
  const db = getDb();
  const content = raw.content;
  if (content.length > cfg.maxInputChars) {
    throw new AppError(422, "VALIDATION_FAILED", `Keep questions under ${cfg.maxInputChars} characters.`, { content: [`At most ${cfg.maxInputChars} characters.`] });
  }
  const conversation = await db.aIConversation.findFirst({ where: own(p, conversationId), select: { id: true, title: true } });
  if (!conversation) throw notFound("Conversation");

  const provider = providerFor(cfg);
  if (!provider) throw new AppError(503, "ASSISTANT_NOT_CONFIGURED", "The AI assistant isn't configured on this server. An administrator must set ANTHROPIC_API_KEY.");

  // Strictly increasing timestamps keep message order stable within one request.
  let clock = Date.now();
  const stamp = () => new Date(Math.max(Date.now(), ++clock));

  const context = await history(conversation.id, cfg);
  const userMessage = await admit(p, conversation.id, content, cfg, stamp);
  {
    if (!conversation.title || conversation.title === DEFAULT_TITLE) {
      await db.aIConversation.update({ where: { id: conversation.id }, data: { title: content.slice(0, 80) } });
    }

    const messages: ChatMessage[] = [...context, { role: "user", content: [{ type: "text", text: content }] }];
    const tools = toolSpecs();
    const today = businessDate();
    const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const toolResults: string[] = [];
    const records: RecordRef[] = [];
    const used: string[] = [];
    let toolCalls = 0;
    let answer = "";
    let status: "ok" | "error" | "limit" = "ok";
    let model = provider.model;
    let errorCode: string | null = null;

    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), cfg.requestTimeoutMs);
    try {
      for (let round = 1; ; round++) {
        if (round > cfg.maxRounds) {
          status = "limit";
          answer = "I couldn't finish this answer within the allowed number of steps. Try a narrower question (one period, one metric).";
          break;
        }
        const res = await provider.complete({
          systemStable: SYSTEM_PROMPT,
          systemContext: systemContext(p, today),
          messages,
          tools,
          maxOutputTokens: cfg.maxOutputTokens,
          signal: abort.signal,
        });
        model = res.model;
        for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += res.usage[k];
        messages.push({ role: "assistant", content: res.content, providerContent: res.providerContent });
        const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();

        if (res.stopReason === "tool_use") {
          const calls = res.content.filter((b): b is Extract<ChatBlock, { type: "tool_call" }> => b.type === "tool_call");
          const results: ChatBlock[] = [];
          for (const call of calls) {
            if (abort.signal.aborted) throw new ProviderError("timeout", "The answer took too long.");
            if (toolCalls >= cfg.maxToolCalls) {
              results.push({ type: "tool_result", id: call.id, isError: true, content: JSON.stringify({ error: "TOOL_LIMIT", message: "Tool-call limit reached for this question. Answer with the results you already have, and say what is missing." }) });
              continue;
            }
            toolCalls++;
            const run = await runTool(p, call.name, call.input, { maxChars: cfg.toolResultMaxChars, timeoutMs: Math.min(cfg.toolTimeoutMs, cfg.requestTimeoutMs) });
            used.push(call.name);
            if (run.ok) toolResults.push(run.content);
            records.push(...run.records);
            results.push({ type: "tool_result", id: call.id, isError: !run.ok, content: run.content });
            await db.aIMessage.create({
              data: {
                conversationId: conversation.id,
                role: "TOOL",
                content: run.content,
                toolName: call.name.slice(0, 100),
                toolCallId: call.id.slice(0, 150),
                toolMetadata: { input: (call.input ?? null) as Prisma.InputJsonValue, ok: run.ok, error: run.error ?? null, truncated: run.truncated },
                createdAt: stamp(),
              },
            });
          }
          messages.push({ role: "user", content: results });
          continue;
        }
        if (res.stopReason === "refusal") {
          answer = "I can't help with that request. I can answer questions about SalesFlow sales, orders, invoices, payments and customers.";
        } else if (res.stopReason === "max_tokens") {
          answer = (text ? text + "\n\n" : "") + "(The answer was cut off at the length limit. Ask a narrower question for the rest.)";
          status = "limit";
        } else {
          answer = text || "I don't have an answer to that from the SalesFlow data.";
        }
        break;
      }
    } catch (e) {
      status = "error";
      if (e instanceof ProviderError) {
        errorCode = e.kind === "timeout" ? "ASSISTANT_TIMEOUT" : "ASSISTANT_UNAVAILABLE";
        answer = e.kind === "timeout" ? "The assistant took too long to answer. Try again, or ask a narrower question." : `${e.message} Your question was saved; try again shortly.`;
      } else {
        logError("assistant", e, { stage: "loop" });
        errorCode = "ASSISTANT_UNAVAILABLE";
        answer = "Something went wrong while answering. Try again shortly.";
      }
    } finally {
      clearTimeout(deadline);
    }

    const unverified = status === "error" ? [] : unverifiedFigures(answer, toolResults);
    const assistantMessage = await db.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: answer,
        toolMetadata: {
          status,
          errorCode,
          provider: provider.name,
          model,
          tools: used,
          toolCalls,
          records: linkedRecords(answer, records) as unknown as Prisma.InputJsonValue,
          unverifiedFigures: unverified,
          usage: { ...usage },
          estimatedCostUsd: costUsd(model, usage),
        },
        createdAt: stamp(),
      },
    });
    await db.aIConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    const dto = { userMessage: messageDto(userMessage), assistantMessage: messageDto(assistantMessage) };
    if (errorCode) {
      throw new AppError(errorCode === "ASSISTANT_TIMEOUT" ? 504 : 503, errorCode, answer, { assistantMessageId: assistantMessage.id });
    }
    return dto;
  }
}

/**
 * Admission, in one short transaction under an advisory lock (all instances):
 * - one question at a time per user (409 ASSISTANT_BUSY),
 * - at most maxConcurrent questions in progress overall (503 ASSISTANT_BUSY),
 * - requestsPerHour questions per user per rolling hour (429),
 * - estimated spend over 24 h below the per-user and total caps (429 ASSISTANT_SPEND_LIMIT).
 * "In progress" = a question with no answer yet, younger than the request timeout,
 * so a crashed request can block its user for at most that long.
 */
async function admit(p: Principal, conversationId: string, content: string, cfg: AssistantConfig, stamp: () => Date) {
  return getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMISSION_LOCK}::bigint)`;
    const pendingSince = new Date(Date.now() - cfg.requestTimeoutMs - 5_000);
    const recentQuestions = await tx.aIMessage.findMany({
      where: { role: "USER", createdAt: { gt: pendingSince } },
      select: { conversationId: true, createdAt: true, conversation: { select: { userId: true } } },
    });
    const pending = [];
    for (const q of recentQuestions) {
      // gte: an answer stamped in the same millisecond (e.g. seeded or imported rows) still counts.
      const answered = await tx.aIMessage.count({ where: { conversationId: q.conversationId, role: "ASSISTANT", createdAt: { gte: q.createdAt } } });
      if (!answered) pending.push(q);
    }
    if (pending.some((q) => q.conversation.userId === p.userId)) throw conflict("ASSISTANT_BUSY", "Wait for the current answer before asking another question.");
    if (pending.length >= cfg.maxConcurrent) throw new AppError(503, "ASSISTANT_BUSY", "The assistant is busy with other questions. Try again in a minute.");

    const hourly = await tx.aIMessage.count({ where: { role: "USER", createdAt: { gte: new Date(Date.now() - 3_600_000) }, conversation: { userId: p.userId } } });
    if (hourly >= cfg.requestsPerHour) {
      throw new AppError(429, "ASSISTANT_RATE_LIMITED", `You've reached ${cfg.requestsPerHour} questions in the last hour. Try again later.`);
    }

    const [spend] = await tx.$queryRaw<{ mine: Prisma.Decimal | null; total: Prisma.Decimal | null }[]>`
      SELECT SUM((m.tool_metadata->>'estimatedCostUsd')::numeric) FILTER (WHERE c.user_id = ${p.userId}::uuid) AS mine,
             SUM((m.tool_metadata->>'estimatedCostUsd')::numeric) AS total
      FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
      WHERE m.role = 'ASSISTANT' AND m.created_at > (now() AT TIME ZONE 'UTC') - interval '24 hours'`;
    if (Number(spend?.mine ?? 0) >= cfg.dailyUsdPerUser) {
      throw new AppError(429, "ASSISTANT_SPEND_LIMIT", "You've reached today's assistant usage limit. Try again tomorrow or ask an administrator.");
    }
    if (Number(spend?.total ?? 0) >= cfg.dailyUsdTotal) {
      throw new AppError(429, "ASSISTANT_SPEND_LIMIT", "The assistant has reached today's usage limit for the organisation. Try again tomorrow.");
    }
    return tx.aIMessage.create({ data: { conversationId, role: "USER", content, createdAt: stamp() } });
  });
}
