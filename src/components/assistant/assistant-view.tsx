"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { apiFetch, ApiError, errorMessage } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { AssistantMessageDto, AssistantStatusDto, ConversationDto, ConversationPage, CreatedConversationDto, SendMessageDto } from "@/services/client/types";
import { useRole } from "@/store/hooks";
import { Blueprint } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";
import { useGo } from "@/components/layout/use-go";

const SUGGESTIONS = [
  "What were our invoiced sales this month?",
  "Which customers generated the most sales this year?",
  "Which invoices are overdue?",
  "How much money is currently outstanding?",
  "How much did we collect last month?",
  "Which sales representative performed best this year?",
  "Show me the sales trend for the last six months.",
];

function relative(iso: string): string {
  const t = Date.parse(iso);
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" });
  return mins < 24 * 60 ? `Today ${time}` : `${formatDate(iso.slice(0, 10))} ${time}`;
}

/**
 * AI assistant on /api/assistant/*. Answers are produced on the server by the
 * configured model with read-only, permission-checked SalesFlow tools; nothing
 * here computes or invents figures.
 */
export function AssistantView() {
  const role = useRole();
  const status = useApiQuery<AssistantStatusDto>("/api/assistant");
  const list = useApiQuery<ConversationPage>("/api/assistant/conversations?pageSize=50");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active = useApiQuery<{ conversation: ConversationDto }>(activeId ? `/api/assistant/conversations/${activeId}` : null);
  const conversation = activeId ? active.data?.conversation : undefined;
  const messages = conversation?.messages ?? [];
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  const configured = status.data?.configured ?? true;
  const maxChars = status.data?.maxInputChars ?? 2000;
  const scope = role.scopedToOwnCustomers
    ? "Answers are limited to your assigned customers and your own sales."
    : `Answers use data your role (${role.title.toLowerCase()}) is authorized to read.`;

  const send = async (text = input) => {
    const question = text.trim();
    if (!question || pending || !configured) return;
    if (question.length > maxChars) return setError(`Keep questions under ${maxChars} characters.`);
    setError("");
    setPending(question);
    setInput("");
    let id = activeId;
    try {
      if (!id) {
        id = (await apiFetch<{ conversation: CreatedConversationDto }>("/api/assistant/conversations", { method: "POST", body: {} })).conversation.id;
        setActiveId(id);
      }
      await apiFetch<SendMessageDto>(`/api/assistant/conversations/${id}/messages`, { method: "POST", body: { content: question } });
    } catch (e) {
      // Provider failures are saved as an error note in the conversation; other refusals (limits, busy, validation) show here.
      const saved = e instanceof ApiError && ["ASSISTANT_UNAVAILABLE", "ASSISTANT_TIMEOUT"].includes(e.code);
      if (!saved) {
        setError(errorMessage(e));
        if (!(e instanceof ApiError && e.code === "ASSISTANT_RATE_LIMITED")) setInput(question);
      }
    } finally {
      setPending(null);
      if (id) invalidate(`/api/assistant/conversations/${id}`);
      invalidate("/api/assistant/conversations?");
    }
  };

  const newConversation = () => {
    setActiveId(null);
    setError("");
    setInput("");
  };

  const empty = messages.length === 0 && !pending;

  return (
    <div className="flex min-h-[calc(100vh-120px)] items-stretch gap-5">
      <Blueprint as="aside" className="hidden w-[260px] flex-none flex-col nav:flex">
        <div className="border-b border-divider p-3">
          <Button icon="plus" className="w-full" onClick={newConversation} disabled={!!pending}>
            New conversation
          </Button>
        </div>
        <div className="px-[14px] pt-3 pb-1 text-[10.5px] tracking-[0.1em] text-neutral-700 uppercase">History</div>
        <div className="flex flex-col overflow-y-auto">
          {list.loading ? <div className="px-3 py-2 text-[12.5px] text-neutral-700">Loading…</div> : null}
          {list.error ? (
            <button type="button" className="px-3 py-2 text-left text-[12.5px] text-danger-800" onClick={list.refetch}>
              Couldn&apos;t load history. Retry
            </button>
          ) : null}
          {list.data && list.data.items.length === 0 ? <div className="px-3 py-2 text-[12.5px] text-neutral-700">No conversations yet.</div> : null}
          {list.data?.items.map((c) => {
            const current = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                disabled={!!pending}
                onClick={() => {
                  setActiveId(c.id);
                  setError("");
                }}
                aria-current={current ? "true" : undefined}
                className={`flex cursor-pointer flex-col gap-[2px] border-0 border-l-2 px-3 py-[9px] text-left hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] ${
                  current ? "border-accent bg-accent-100" : "border-transparent bg-transparent"
                }`}
              >
                <span className="text-[13.5px] leading-[1.3] font-medium">{c.title}</span>
                <span className="text-[11.5px] text-neutral-700">{relative(c.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      </Blueprint>

      <Blueprint as="section" className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-[18px] py-3">
          <div className="flex flex-col">
            <h3 className="panel-title">{conversation ? conversation.title : "New conversation"}</h3>
            <span className="text-[12px] text-neutral-700">{scope}</span>
          </div>
          {status.data?.offlineTestProvider ? <span className="tag bg-warning-100 text-warning-800">Offline test provider · not a language model</span> : null}
        </div>

        <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-[18px] py-5" aria-live="polite">
          {!configured ? (
            <AlertBanner>The AI assistant isn&apos;t configured on this server yet. An administrator needs to set ANTHROPIC_API_KEY; see docs/assistant.md.</AlertBanner>
          ) : null}
          {activeId && active.loading ? <SkeletonRows /> : null}
          {activeId && active.error && !conversation ? <AlertBanner>{errorMessage(active.error)}</AlertBanner> : null}
          {empty && !(activeId && active.loading) ? (
            <div className="m-auto flex max-w-[560px] flex-col items-center gap-[14px] text-center">
              <span className="text-accent">
                <Icon name="assistant" size={22} />
              </span>
              <h2 className="m-0 text-[26px]">Ask about customers, sales and receivables</h2>
              <p className="text-muted m-0 text-[13px]">
                Answers come from the SalesFlow database through read-only, permission-checked lookups. Results show their period, currency and conversion basis.
              </p>
            </div>
          ) : null}
          {messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}
          {pending ? (
            <>
              <div className="max-w-[min(560px,85%)] self-end bg-accent-100 px-[14px] py-[9px] text-[14px] whitespace-pre-wrap text-accent-900">{pending}</div>
              <div className="text-[13px] text-neutral-700">Querying authorized data…</div>
            </>
          ) : null}
          <div ref={end} />
        </div>

        <div className="flex flex-col gap-[10px] border-t border-divider px-[18px] py-3">
          {error ? (
            <div role="alert" className="text-[13px] text-danger-800">
              {error}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-[6px]">
            {SUGGESTIONS.map((t) => (
              <button
                key={t}
                type="button"
                disabled={!!pending || !configured}
                className="tag tag-outline cursor-pointer bg-transparent px-[10px] py-1 text-[12px] hover:bg-accent-100"
                onClick={() => setInput(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              className="input min-h-11 resize-none"
              aria-label="Message"
              rows={2}
              maxLength={maxChars}
              placeholder={configured ? "Ask a question about your sales data" : "The assistant is not configured"}
              disabled={!configured}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button variant="primary" icon="send" aria-label="Send" className="h-11 w-12" disabled={!input.trim() || !!pending || !configured} onClick={() => void send()} />
          </div>
        </div>
      </Blueprint>
    </div>
  );
}

function Message({ message: m }: { message: AssistantMessageDto }) {
  const go = useGo();
  if (m.role === "user") {
    return <div className="max-w-[min(560px,85%)] self-end bg-accent-100 px-[14px] py-[9px] text-[14px] whitespace-pre-wrap text-accent-900">{m.content}</div>;
  }
  if (m.status === "error") {
    return (
      <div role="status" className="flex max-w-[760px] gap-[10px] border border-divider px-[14px] py-[10px] text-[13px] text-neutral-800">
        <span className="text-danger-700">
          <Icon name="alert" />
        </span>
        <span>{m.content}</span>
      </div>
    );
  }
  const open = (r: AssistantMessageDto["records"][number]) => (r.kind === "invoice" ? go.invoice(r.id) : r.kind === "order" ? go.order(r.id) : go.customer(r.id));
  const href = (r: AssistantMessageDto["records"][number]) => (r.kind === "invoice" ? ROUTES.invoices : r.kind === "order" ? ROUTES.orders : ROUTES.customer(r.id));
  return (
    <div className="flex max-w-[760px] flex-col gap-[10px] self-stretch">
      <span className="text-[11px] tracking-[0.08em] text-accent-700 uppercase">SalesFlow Assistant</span>
      <RichText text={m.content} />
      {m.unverifiedFigures.length ? (
        <p className="m-0 text-[12px] text-warning-800">
          Not returned by SalesFlow lookups (may be calculated, check before use): {m.unverifiedFigures.join(", ")}
        </p>
      ) : null}
      {m.records.length ? (
        <div className="flex flex-wrap items-center gap-[6px] text-[12px]">
          <span className="text-neutral-700">Open:</span>
          {m.records.map((r) => (
            <a
              key={r.kind + r.id}
              href={href(r)}
              className="tag tag-outline px-[8px] py-[2px]"
              onClick={(e) => {
                e.preventDefault();
                open(r);
              }}
            >
              {r.label}
            </a>
          ))}
        </div>
      ) : null}
      {m.tools.length ? <span className="text-[11px] text-neutral-700">Sources: {[...new Set(m.tools)].map((t) => t.replace(/^get_/, "").replace(/_/g, " ")).join(", ")}</span> : null}
    </div>
  );
}

/** Minimal, safe rendering of the model's markdown: paragraphs, bullet lists, pipe tables and **bold** (React escapes all text). */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={i} className="overflow-x-auto border border-divider px-3 py-1">
          <table className="table">
            <thead>
              <tr>
                {head?.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} className={/^[−-]?[\d.,\s]+(ALL|EUR|USD)?%?$/.test(c) ? "tabular-nums" : undefined}>
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (i < lines.length && (/^\s*[-*•]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={i} className="m-0 flex flex-col gap-1 pl-5 text-[14px]">
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (line.trim()) {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^\s*\|/.test(lines[i]) && !/^\s*([-*•]|\d+\.)\s+/.test(lines[i])) para.push(lines[i++].replace(/^#+\s*/, ""));
      blocks.push(
        <p key={i} className="m-0 text-[14px]">
          {para.map((p, k) => (
            <Fragment key={k}>
              {k ? <br /> : null}
              {inline(p)}
            </Fragment>
          ))}
        </p>,
      );
      continue;
    }
    i++;
  }
  return <>{blocks}</>;
}

function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}
