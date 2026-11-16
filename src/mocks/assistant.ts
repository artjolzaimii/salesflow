/**
 * Canned AI-assistant transcripts for preview mode.
 *
 * The figures are computed from the preview fixtures so they agree with the rest
 * of the UI, and every transcript is flagged `fixture: true` so the screen labels
 * it as preview data. No model or database is queried in this phase.
 */
import { formatMoney, toAllEquivalent } from "@/lib/money";
import type { Conversation, SalesDataset } from "@/lib/types";

export const ASSISTANT_SUGGESTIONS = [
  "Which customers generated the most revenue this month?",
  "Show outstanding invoices from Tirana.",
  "What were our sales in EUR last month?",
  "Which sales representative has the highest invoiced revenue?",
  "Show the latest orders for Market Alba.",
];

/** Reply shown when a new question is sent: the preview has no assistant backend. */
export const ASSISTANT_OFFLINE_REPLY =
  "The assistant service is not connected in this preview, so no data was queried. In production this message is sent to POST /api/assistant/conversations/{id}/messages, which runs the model server-side against data your role can access.";

export function buildFixtureConversations(data: SalesDataset): Conversation[] {
  const customer = (id: string) => data.customers.find((c) => c.id === id)!;

  const november = data.invoices.filter((i) => i.issueDate >= "2026-11-01");
  const byCustomer: Record<string, number> = {};
  november.forEach((i) => {
    byCustomer[i.customerId] = (byCustomer[i.customerId] || 0) + toAllEquivalent(i.taxable, i);
  });
  const top = Object.entries(byCustomer)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, v]): [string, string, string] => [customer(id).name, customer(id).city, formatMoney(v, "ALL")]);

  const tirana = data.invoices
    .filter((i) => i.total > i.paid && customer(i.customerId).city === "Tiranë")
    .map((i): [string, string, string] => [i.id, customer(i.customerId).name, formatMoney(i.total - i.paid, i.currency)]);

  const eur = data.invoices.filter((i) => i.currency === "EUR" && i.issueDate >= "2026-10-01" && i.issueDate < "2026-11-01");

  return [
    {
      id: "c1",
      title: "Top customers by revenue, November",
      updatedLabel: "Today, 09:42",
      fixture: true,
      messages: [
        { role: "user", text: "Which customers generated the most revenue this month?" },
        {
          role: "assistant",
          text: "Invoiced net sales (excl. VAT) for 1–16 Nov 2026, converted to ALL at the rate recorded on each invoice.",
          table: { columns: ["Customer", "City", "Net sales"], rows: top },
        },
        { role: "user", text: "Only the ones in Tiranë." },
        {
          role: "assistant",
          text: "Same period and basis, filtered to customers with a Tiranë address.",
          table: { columns: ["Customer", "City", "Net sales"], rows: top.filter((r) => r[1] === "Tiranë") },
        },
      ],
    },
    {
      id: "c2",
      title: "Outstanding invoices in Tiranë",
      updatedLabel: "Yesterday, 16:10",
      fixture: true,
      messages: [
        { role: "user", text: "Show outstanding invoices from Tirana." },
        {
          role: "assistant",
          text: `${tirana.length} invoices with an open balance. Amounts are in each invoice’s own currency.`,
          table: { columns: ["Invoice", "Customer", "Outstanding"], rows: tirana },
        },
      ],
    },
    {
      id: "c3",
      title: "EUR sales, October",
      updatedLabel: "12 Nov",
      fixture: true,
      messages: [
        { role: "user", text: "What were our sales in EUR last month?" },
        {
          role: "assistant",
          text: "Invoices issued in EUR between 1 and 31 Oct 2026.",
          kpis: [
            { label: "Net sales", value: formatMoney(eur.reduce((a, i) => a + i.taxable, 0), "EUR") },
            { label: "Gross incl. VAT", value: formatMoney(eur.reduce((a, i) => a + i.total, 0), "EUR") },
            { label: "Invoices", value: String(eur.length) },
            { label: "ALL equivalent (net)", value: formatMoney(eur.reduce((a, i) => a + toAllEquivalent(i.taxable, i), 0), "ALL") },
          ],
        },
      ],
    },
  ];
}
