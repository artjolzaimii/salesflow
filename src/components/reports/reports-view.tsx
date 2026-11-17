"use client";

import { useState, type ReactNode } from "react";
import { chartValue, formatDecimal } from "@/lib/decimal-format";
import { formatDate } from "@/lib/money";
import { errorMessage, qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { CollectionsReportDto, ReceivablesReportDto, SalesReportDto } from "@/services/client/types";
import { Blueprint, Panel } from "@/components/ui/blueprint";
import { Field, Segmented } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { ListError, SkeletonRows } from "@/components/ui/states";
import { useGo } from "@/components/layout/use-go";
import { DEFAULT_PERIOD, PeriodPicker, periodParams, type PeriodState } from "./period-picker";

type SalesGroup = "trend" | "rep" | "customer" | "product" | "category" | "currency";
type Group = SalesGroup | "outstanding" | "overdue" | "collections";
type Basis = "ALL_EQ" | "ALL" | "EUR" | "USD";

const GROUPS: { value: Group; label: string }[] = [
  { value: "trend", label: "Trend" },
  { value: "rep", label: "Representative" },
  { value: "customer", label: "Customer" },
  { value: "product", label: "Product" },
  { value: "category", label: "Category" },
  { value: "currency", label: "Currency" },
  { value: "outstanding", label: "Outstanding" },
  { value: "overdue", label: "Overdue" },
  { value: "collections", label: "Collections" },
];

const BASES: { value: Basis; label: string }[] = [
  { value: "ALL_EQ", label: "All → ALL" },
  { value: "ALL", label: "ALL only" },
  { value: "EUR", label: "EUR only" },
  { value: "USD", label: "USD only" },
];

const PAGE_SIZE = 15;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (v: string, cur?: string) => formatDecimal(v, 2, 2) + (cur ? " " + cur : "");
const bucketLabel = (key: string, unit: string | null) => (unit === "month" ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : formatDate(key));

/** Reports from GET /api/reports/sales, /collections and /receivables (all scoped to the caller on the server). */
export function ReportsView() {
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD);
  const [group, setGroup] = useState<Group>("rep");
  const [basis, setBasis] = useState<Basis>("ALL_EQ");
  const [page, setPage] = useState(0);
  const params = periodParams(period);
  const isSales = !["outstanding", "overdue", "collections"].includes(group);
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  // The sales report always runs: its summary feeds the cards for every view.
  const sales = useApiQuery<SalesReportDto>(
    params ? "/api/reports/sales" + qs({ ...params, basis, groupBy: isSales ? group : "trend", page: isSales ? page + 1 : 1, pageSize: isSales ? PAGE_SIZE : 1 }) : null,
  );
  const collections = useApiQuery<CollectionsReportDto>(
    params && group === "collections" ? "/api/reports/collections" + qs({ ...params, basis, groupBy: "trend", page: page + 1, pageSize: PAGE_SIZE }) : null,
  );
  const receivables = useApiQuery<ReceivablesReportDto>(
    group === "outstanding" || group === "overdue"
      ? "/api/reports/receivables" + qs({ basis, overdueOnly: group === "overdue", page: page + 1, pageSize: PAGE_SIZE })
      : null,
  );
  const s = sales.data;
  const cur = basis === "ALL_EQ" ? "ALL" : basis;
  const basisText =
    basis === "ALL_EQ"
      ? "Reporting currency: ALL. EUR and USD amounts are converted at the exchange rate recorded on each invoice (orders: on each order); no current-rate revaluation."
      : `Showing ${basis} records only, in ${basis}. No conversion applied.`;

  const cards: { label: string; value: string; note: string }[] = s
    ? [
        { label: "Invoiced sales (net)", value: money(s.summary.invoiced.net, cur), note: `${s.summary.invoiced.invoices} issued invoices · by issue date` },
        { label: "Gross invoiced", value: money(s.summary.invoiced.gross, cur), note: `incl. VAT ${money(s.summary.invoiced.vat)}` },
        { label: "Payments collected", value: money(s.summary.collected.amount, cur), note: `${s.summary.collected.payments} payments · by payment date` },
        { label: "Order pipeline", value: money(s.summary.pipeline.value, cur), note: `${s.summary.pipeline.orders} confirmed, not invoiced · by order date` },
        { label: "Outstanding", value: money(s.summary.receivables.outstanding, cur), note: `as of ${formatDate(s.summary.receivables.asOf)}` },
        { label: "Overdue", value: money(s.summary.receivables.overdue, cur), note: `as of ${formatDate(s.summary.receivables.asOf)}` },
      ]
    : [];

  return (
    <>
      <PageHeader title="Reports" subtitle={basisText} />
      <div className="flex flex-wrap items-end gap-x-5 gap-y-[14px]">
        <PeriodPicker value={period} onChange={reset(setPeriod)} idPrefix="rp" />
        <Field label="Currency basis">
          <Segmented name="rc" label="Currency basis" options={BASES} value={basis} onChange={(v) => reset(setBasis)(v as Basis)} />
        </Field>
      </div>
      <Field label="Report">
        <Segmented name="rg" label="Report" options={GROUPS} value={group} onChange={(v) => reset(setGroup)(v as Group)} />
      </Field>

      {sales.error && !s ? <ListError message={`Could not load the report. ${errorMessage(sales.error)}`} onRetry={sales.refetch} /> : null}
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {s
          ? cards.map((k) => (
              <Blueprint key={k.label} className="flex flex-col gap-1 px-4 py-[14px]">
                <span className="kicker">{k.label}</span>
                <span className="font-heading text-[24px] font-semibold tabular-nums">{k.value}</span>
                <span className="text-[11.5px] text-neutral-700">{k.note}</span>
              </Blueprint>
            ))
          : null}
      </div>
      {!s && sales.loading ? <SkeletonRows /> : null}

      {isSales ? <SalesBreakdown q={sales} group={group as SalesGroup} basis={basis} page={page} onPage={setPage} /> : null}
      {group === "collections" ? <CollectionsBreakdown q={collections} page={page} onPage={setPage} /> : null}
      {group === "outstanding" || group === "overdue" ? <ReceivablesBreakdown q={receivables} overdue={group === "overdue"} basis={basis} page={page} onPage={setPage} /> : null}
    </>
  );
}

interface Q<T> {
  data: T | undefined;
  loading: boolean;
  error?: { message: string };
  refetch: () => void;
}

function BreakdownPanel<T>({ q, note, empty, children, pager }: { q: Q<T>; note: ReactNode; empty: boolean; children: ReactNode; pager: ReactNode }) {
  return (
    <Panel className="gap-[10px] py-[14px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="panel-title">Breakdown</h3>
        <span className="panel-note">{note}</span>
      </div>
      {q.loading ? <SkeletonRows /> : null}
      {q.error && !q.data ? <ListError message={`Could not load the breakdown. ${errorMessage(q.error)}`} onRetry={q.refetch} /> : null}
      {q.data && empty ? <div className="text-muted py-8 text-center">Nothing in this period and currency.</div> : null}
      {q.data && !empty ? (
        <>
          <div className="overflow-x-auto">{children}</div>
          {pager}
        </>
      ) : null}
    </Panel>
  );
}

function SalesBreakdown({ q, group, basis, page, onPage }: { q: Q<SalesReportDto>; group: SalesGroup; basis: Basis; page: number; onPage: (p: number) => void }) {
  const r = q.data;
  const rc = basis === "ALL_EQ" ? "ALL" : basis;
  const rows = r?.groupBy === group ? r.items : [];
  const max = Math.max(1, ...rows.map((x) => chartValue(x.net)));
  const groupLabel = { trend: r?.trendUnit === "month" ? "Month" : "Day", rep: "Representative", customer: "Customer", product: "Product", category: "Category", currency: "Currency" }[group];
  const currency = group === "currency";
  const columns: { title: string; right?: boolean }[] = [
    { title: groupLabel },
    { title: group === "product" ? "Quantity" : "Invoices", right: true },
    { title: currency ? "Net (original)" : `Net (${rc})`, right: true },
    { title: "VAT", right: true },
    { title: currency ? "Gross (original)" : "Gross", right: true },
    ...(currency ? [{ title: "Gross (ALL equivalent)", right: true }] : []),
  ];
  const note = r
    ? `${r.period.label} · by invoice issue date · ${r.summary.invoiced.invoices} invoices${group === "rep" ? " · credited to the order's representative" : ""}${group === "product" || group === "category" ? " · line amounts at each invoice's rate" : ""}`
    : "";
  return (
    <BreakdownPanel q={q} note={note} empty={rows.length === 0 || (group === "trend" && rows.every((x) => x.count === "0") && (r?.pages ?? 1) === 1)} pager={r ? <Pager page={page} pages={r.pages} total={r.total} size={r.pageSize} onPage={onPage} /> : null}>
      <table className="table min-w-[720px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.title} className={c.right ? "text-right" : undefined}>
                {c.title}
              </th>
            ))}
            {currency ? null : <th className="w-[22%]">Share of net</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.key}>
              <td>
                {group === "trend" ? bucketLabel(x.key, r?.trendUnit ?? null) : x.label}
                {x.sub && group !== "trend" ? <span className="text-neutral-700"> · {x.sub}</span> : null}
              </td>
              <td className="num">{group === "product" ? `${formatDecimal(x.count, 0, 3)} ${x.unit ?? ""}` : x.count}</td>
              <td className="num">{money(x.net)}</td>
              <td className="num">{money(x.vat)}</td>
              <td className="num">{money(x.gross)}</td>
              {currency ? <td className="num">{x.grossAll ? money(x.grossAll, "ALL") : "—"}</td> : null}
              {currency ? null : (
                <td title={`${money(x.net, rc)} net`}>
                  <div className="h-[10px] bg-neutral-200">
                    <div className="h-full bg-accent" style={{ width: Math.round((chartValue(x.net) / max) * 100) + "%" }} />
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </BreakdownPanel>
  );
}

function CollectionsBreakdown({ q, page, onPage }: { q: Q<CollectionsReportDto>; page: number; onPage: (p: number) => void }) {
  const r = q.data;
  const rows = r?.items ?? [];
  const max = Math.max(1, ...rows.map((x) => chartValue(x.amount)));
  return (
    <BreakdownPanel
      q={q}
      note={r ? `${r.period.label} · by payment date${r.basis === "ALL_EQ" ? " · converted at each invoice's rate" : ""}` : ""}
      empty={rows.length === 0}
      pager={r ? <Pager page={page} pages={r.pages} total={r.total} size={r.pageSize} onPage={onPage} /> : null}
    >
      <table className="table min-w-[560px]">
        <thead>
          <tr>
            <th>{r?.trendUnit === "month" ? "Month" : "Day"}</th>
            <th className="text-right">Payments</th>
            <th className="text-right">Collected ({r?.currency ?? "ALL"})</th>
            <th className="w-[30%]">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.key}>
              <td>{bucketLabel(x.key, r?.trendUnit ?? null)}</td>
              <td className="num">{x.count}</td>
              <td className="num">{money(x.amount)}</td>
              <td title={money(x.amount, r?.currency)}>
                <div className="h-[10px] bg-neutral-200">
                  <div className="h-full bg-accent" style={{ width: Math.round((chartValue(x.amount) / max) * 100) + "%" }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </BreakdownPanel>
  );
}

function ReceivablesBreakdown({ q, overdue, basis, page, onPage }: { q: Q<ReceivablesReportDto>; overdue: boolean; basis: Basis; page: number; onPage: (p: number) => void }) {
  const r = q.data;
  const go = useGo();
  const rows = r?.items ?? [];
  const converted = basis === "ALL_EQ";
  return (
    <BreakdownPanel
      q={q}
      note={
        r
          ? `${overdue ? "Overdue" : "Open"} invoices as of ${formatDate(r.asOf)} · not limited by the period · aging: ${r.summary.aging
              .map((a) => `${a.bucket} ${formatDecimal(a.amount, 0, 0)}`)
              .join(" · ")} ${r.currency}`
          : ""
      }
      empty={rows.length === 0}
      pager={r ? <Pager page={page} pages={r.pages} total={r.total} size={r.pageSize} onPage={onPage} /> : null}
    >
      <table className="table min-w-[860px]">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Representative</th>
            <th>Due</th>
            <th className="text-right">Days overdue</th>
            <th className="text-right">Outstanding</th>
            {converted ? <th className="text-right">ALL equivalent</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id} className="clickable" onClick={() => go.invoice(x.id)}>
              <td className="font-medium whitespace-nowrap">{x.invoiceNumber}</td>
              <td>{x.customer.businessName}</td>
              <td>{x.salesRep}</td>
              <td className="whitespace-nowrap">{formatDate(x.dueDate)}</td>
              <td className="num">{x.daysOverdue || "—"}</td>
              <td className="num whitespace-nowrap">
                {money(x.outstanding)} <span className="cur-suffix">{x.currencyCode}</span>
              </td>
              {converted ? <td className="num whitespace-nowrap">{money(x.outstandingAll)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </BreakdownPanel>
  );
}
