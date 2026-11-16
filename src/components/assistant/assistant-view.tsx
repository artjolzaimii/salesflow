"use client";

import { ASSISTANT_SUGGESTIONS } from "@/mocks/assistant";
import type { AssistantMessage } from "@/lib/types";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Blueprint } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * AI assistant shell. Fixture transcripts are labelled as preview data, and new
 * questions get an explicit "service not connected" reply: nothing here queries
 * a model or the database.
 */
export function AssistantView() {
  const conversations = usePreview((s) => s.conversations);
  const activeId = usePreview((s) => s.activeConversationId);
  const pending = usePreview((s) => s.assistantPending);
  const input = usePreview((s) => s.assistantInput);
  const role = useRole();
  const actions = useActions();

  const active = conversations.find((c) => c.id === activeId);
  const empty = !active || active.messages.length === 0;
  const scope = role.scopedToOwnCustomers
    ? "Answers are limited to your assigned customers."
    : `Answers use data your role (${role.title.toLowerCase()}) is authorized to read.`;

  return (
    <div className="flex min-h-[calc(100vh-120px)] items-stretch gap-5">
      <Blueprint as="aside" className="hidden w-[260px] flex-none flex-col nav:flex">
        <div className="border-b border-divider p-3">
          <Button icon="plus" className="w-full" onClick={actions.newConversation}>
            New conversation
          </Button>
        </div>
        <div className="px-[14px] pt-3 pb-1 text-[10.5px] tracking-[0.1em] text-neutral-700 uppercase">History</div>
        <div className="flex flex-col overflow-y-auto">
          {conversations.map((c) => {
            const current = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => actions.selectConversation(c.id)}
                aria-current={current ? "true" : undefined}
                className={`flex cursor-pointer flex-col gap-[2px] border-0 border-l-2 px-3 py-[9px] text-left hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] ${
                  current ? "border-accent bg-accent-100" : "border-transparent bg-transparent"
                }`}
              >
                <span className="text-[13.5px] leading-[1.3] font-medium">{c.title}</span>
                <span className="text-[11.5px] text-neutral-700">{c.updatedLabel}</span>
              </button>
            );
          })}
        </div>
      </Blueprint>

      <Blueprint as="section" className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-[18px] py-3">
          <div className="flex flex-col">
            <h3 className="panel-title">{active ? active.title : "New conversation"}</h3>
            <span className="text-[12px] text-neutral-700">{scope}</span>
          </div>
          {active?.fixture ? (
            <span className="tag bg-warning-100 text-warning-800">Preview transcript · fixture data, not live results</span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-[18px] py-5" aria-live="polite">
          {empty ? (
            <div className="m-auto flex max-w-[560px] flex-col items-center gap-[14px] text-center">
              <span className="text-accent">
                <Icon name="assistant" size={22} />
              </span>
              <h2 className="m-0 text-[26px]">Ask about customers, sales and receivables</h2>
              <p className="text-muted m-0 text-[13px]">
                Answers come from the SalesFlow database through a server-side endpoint. Results show their period, currency and conversion basis.
              </p>
            </div>
          ) : null}
          {active?.messages.map((m, i) => <Message key={i} message={m} />)}
          {pending ? <div className="text-[13px] text-neutral-700">Querying authorized data…</div> : null}
        </div>

        <div className="flex flex-col gap-[10px] border-t border-divider px-[18px] py-3">
          <div className="flex flex-wrap gap-[6px]">
            {ASSISTANT_SUGGESTIONS.map((t) => (
              <button
                key={t}
                type="button"
                className="tag tag-outline cursor-pointer bg-transparent px-[10px] py-1 text-[12px] hover:bg-accent-100"
                onClick={() => actions.setAssistantInput(t)}
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
              placeholder="Ask a question about your sales data"
              value={input}
              onChange={(e) => actions.setAssistantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  actions.sendMessage();
                }
              }}
            />
            <Button variant="primary" icon="send" aria-label="Send" className="h-11 w-12" disabled={!input.trim() || pending} onClick={actions.sendMessage} />
          </div>
        </div>
      </Blueprint>
    </div>
  );
}

function Message({ message: m }: { message: AssistantMessage }) {
  if (m.role === "user") {
    return <div className="max-w-[min(560px,85%)] self-end bg-accent-100 px-[14px] py-[9px] text-[14px] text-accent-900">{m.text}</div>;
  }
  if (m.role === "error") {
    return (
      <div role="status" className="flex max-w-[760px] gap-[10px] border border-divider px-[14px] py-[10px] text-[13px] text-neutral-800">
        <span className="text-danger-700">
          <Icon name="alert" />
        </span>
        <span>{m.text}</span>
      </div>
    );
  }
  return (
    <div className="flex max-w-[760px] flex-col gap-[10px] self-stretch">
      <span className="text-[11px] tracking-[0.08em] text-accent-700 uppercase">SalesFlow Assistant</span>
      <p className="m-0 text-[14px]">{m.text}</p>
      {m.table ? (
        <div className="overflow-x-auto border border-divider px-3 py-1">
          <table className="table">
            <thead>
              <tr>
                {m.table.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.table.rows.map(([a, b, c]) => (
                <tr key={a + b}>
                  <td className="font-medium">{a}</td>
                  <td>{b}</td>
                  <td className="tabular-nums">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {m.kpis ? (
        <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          {m.kpis.map((k) => (
            <Blueprint key={k.label} className="flex flex-col gap-[2px] px-3 py-[10px]">
              <span className="text-[11px] text-neutral-700">{k.label}</span>
              <span className="font-heading text-[19px] font-semibold tabular-nums">{k.value}</span>
            </Blueprint>
          ))}
        </div>
      ) : null}
    </div>
  );
}
