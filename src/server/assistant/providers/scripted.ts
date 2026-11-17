import "server-only";
import { ProviderError, type ChatBlock, type CompletionRequest, type CompletionResult, type LlmProvider } from "../types";

/**
 * Deterministic, offline provider for automated tests (ASSISTANT_PROVIDER=scripted).
 * It picks a tool from keywords and then repeats the tool's own JSON figures, so
 * the whole pipeline (endpoints, tools, scope, persistence, UI) runs without a paid
 * API. It never invents a figure. Not for production use: every answer starts with
 * "[Offline test provider]".
 *
 * Control markers in the question: [provider-down], [loop], [bad-tool], [bad-args],
 * [fabricate], [slow].
 */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly model = "scripted-test-provider";

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const last = req.messages[req.messages.length - 1];
    const question = [...req.messages].reverse().find((m) => m.role === "user" && m.content.some((b) => b.type === "text"));
    const text = question?.content.find((b) => b.type === "text")?.text.toLowerCase() ?? "";
    const results = last?.role === "user" ? last.content.filter((b) => b.type === "tool_result") : [];

    if (text.includes("[provider-down]")) throw new ProviderError("unavailable", "The AI service is unavailable right now.");
    if (text.includes("[slow]")) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 60_000);
        req.signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new ProviderError("timeout", "The AI service took too long to answer."));
        });
      });
    }
    if (text.includes("[fabricate]")) return answer("Invoiced sales were 987,654.32 ALL this month.");

    if (results.length === 0 || text.includes("[loop]")) {
      const call = pick(text);
      return { content: [{ type: "tool_call", id: "call_" + Math.random().toString(36).slice(2, 10), name: call.name, input: call.input }], stopReason: "tool_use", usage: ZERO, model: this.model };
    }
    return answer(results.map((r) => summarise(r as Extract<ChatBlock, { type: "tool_result" }>)).join("\n"));

    function answer(t: string): CompletionResult {
      return { content: [{ type: "text", text: "[Offline test provider] " + t }], stopReason: "end_turn", usage: ZERO, model: "scripted-test-provider" };
    }
  }
}

const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function pick(q: string): { name: string; input: Record<string, unknown> } {
  if (q.includes("[bad-tool]")) return { name: "run_sql", input: { sql: "DELETE FROM invoices" } };
  if (q.includes("[bad-args]")) return { name: "get_top_customers", input: { limit: 5000, period: "fortnight" } };
  const inv = q.match(/inv-\d{4}-\d+/);
  if (inv) return { name: "get_invoice_details", input: { invoiceNumber: inv[0].toUpperCase() } };
  const so = q.match(/so-\d{4}-\d+/);
  if (so) return { name: "get_order_details", input: { orderNumber: so[0].toUpperCase() } };
  const range = q.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|\.\.|–|-)\s*(\d{4}-\d{2}-\d{2})/);
  const period = range ? { period: "custom", from: range[1], to: range[2] } : { period: "year" };
  if (q.includes("overdue")) return { name: "get_overdue_invoices", input: {} };
  if (q.includes("outstanding") || q.includes("owed")) return { name: "get_outstanding_invoices", input: {} };
  if (q.includes("collect")) return { name: "get_payment_collections", input: { ...period, groupBy: "currency" } };
  if (q.includes("product")) return { name: "get_top_products", input: { ...period, limit: 5 } };
  if (q.includes("representative")) return { name: "get_sales_by_representative", input: period };
  if (q.includes("customer named")) return { name: "get_customer_details", input: { query: q.split("customer named")[1].trim().replace(/[?.]$/, "") } };
  if (q.includes("customer")) return { name: "get_top_customers", input: { ...period, limit: 5 } };
  if (q.includes("trend")) return { name: "get_sales_trends", input: period };
  return { name: "get_dashboard_summary", input: period };
}

/** Repeats figures from the tool's JSON (never computes new ones). */
function summarise(r: Extract<ChatBlock, { type: "tool_result" }>): string {
  if (r.isError) return `I couldn't retrieve that: ${(JSON.parse(r.content) as { message?: string }).message ?? "lookup failed"}.`;
  const d = JSON.parse(r.content) as Record<string, unknown>;
  const data = (d.data ?? d) as Record<string, unknown>;
  if (Array.isArray(data.invoices)) {
    const rows = data.invoices as { invoiceNumber: string; customer: string; outstanding: string; currency: string; daysOverdue: number }[];
    if (!rows.length) return "No open invoices match.";
    return rows.map((i) => `${i.invoiceNumber} · ${i.customer} · ${i.outstanding} ${i.currency}${i.daysOverdue ? ` · ${i.daysOverdue} days overdue` : ""}`).join("\n");
  }
  if (Array.isArray(data.rows)) {
    const rows = data.rows as { name?: string; label?: string; net?: string; amount?: string }[];
    if (!rows.length) return "No records in this period.";
    return rows.map((x) => `${x.name ?? x.label}: ${x.net ?? x.amount} ${String(data.currency ?? "")}`.trim()).join("\n");
  }
  if (data.invoicedSales) {
    const s = data.invoicedSales as { net: string };
    const period = data.period as { from: string; to: string };
    return `Invoiced sales (net) ${period.from} to ${period.to}: ${s.net} ALL.`;
  }
  if (data.invoiceNumber) return `${data.invoiceNumber}: total ${(data.totals as { grandTotal: string }).grandTotal} ${data.currency}, outstanding ${data.outstanding} ${data.currency}.`;
  if (data.orderNumber) return `${data.orderNumber}: ${data.status}, total ${(data.totals as { grandTotal: string }).grandTotal} ${data.currency}.`;
  if (data.name && data.customerId) return `${data.name} (${data.city}), status ${data.status}.`;
  if (data.found === false || data.note) return String(data.note);
  return "Retrieved.";
}
