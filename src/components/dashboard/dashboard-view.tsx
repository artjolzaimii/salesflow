"use client";

import { useState, type ReactNode } from "react";
import { chartValue, formatDecimal, formatWholeDecimal } from "@/lib/decimal-format";
import { INVOICE_PAYMENT_STATUS_LABEL } from "@/lib/invoice-status";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { errorMessage, qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { DashboardDto } from "@/services/client/types";
import { useRole } from "@/store/hooks";
import { Blueprint, Panel, PanelHeader } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCards } from "@/components/ui/states";
import { StatusBadge, statusColor, type BadgeLabel } from "@/components/ui/status-badge";
import { InvoiceStatusBadges } from "@/components/invoices/invoice-badges";
import { useGo } from "@/components/layout/use-go";
import { DEFAULT_PERIOD, PeriodPicker, periodParams, type PeriodState } from "@/components/reports/period-picker";

const GRID_2 = "grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const all = (v: string) => `${formatDecimal(v, 2, 2)} ALL`;

interface Delta {
  pct: number;
  text: string;
  label: string;
}

/** Change vs the comparison period (display only); none when the comparison is zero. */
function delta(current: string | number, previous: string | number, label: string): Delta | null {
  const prev = typeof previous === "number" ? previous : chartValue(previous);
  if (!prev) return null;
  const cur = typeof current === "number" ? current : chartValue(current);
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  return { pct, text: (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%", label };
}

/** Dashboard from GET /api/reports/dashboard. Amounts in ALL at the rate stored on each invoice or order. */
export function DashboardView() {
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD);
  const params = periodParams(period);
  const q = useApiQuery<DashboardDto>(params ? "/api/reports/dashboard" + qs(params) : null);
  const d = q.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${d ? `As of ${formatDate(d.asOf)}. ` : ""}Amounts in ALL; EUR and USD invoices converted at the rate recorded on each invoice.`}
      />
      <PeriodPicker value={period} onChange={setPeriod} idPrefix="db" />
      {q.loading ? <SkeletonCards /> : null}
      {q.error && !d ? (
        <Blueprint role="alert" className="flex items-start gap-[14px] p-7 text-danger-800">
          <Icon name="alert" />
          <div className="flex flex-col gap-[10px] text-text">
            <div className="font-medium">Dashboard data could not be loaded. {errorMessage(q.error)}</div>
            <Button className="self-start" onClick={q.refetch}>
              Retry
            </Button>
          </div>
        </Blueprint>
      ) : null}
      {d && isEmpty(d) ? (
        <Blueprint className="flex flex-col items-center gap-2 px-7 py-12 text-center">
          <h3 className="m-0">No sales activity yet</h3>
          <p className="text-muted m-0 max-w-[420px]">
            KPIs and charts fill in once the first invoice is issued. Start by registering a customer and creating an order.
          </p>
        </Blueprint>
      ) : null}
      {d && !isEmpty(d) ? <DashboardReady d={d} /> : null}
    </>
  );
}

/** Nothing at all in the caller's scope (not merely a quiet period). */
const isEmpty = (d: DashboardDto) => !d.recent.orders.length && !d.recent.invoices.length && d.kpis.receivables.openInvoices === 0;

/** Scale for the monthly bars: the largest unit that keeps the biggest bar readable. */
function chartScale(max: number) {
  if (max >= 1e6) return { div: 1e6, unit: "millions ALL", digits: 2 };
  if (max >= 1e3) return { div: 1e3, unit: "thousands ALL", digits: 1 };
  return { div: 1, unit: "ALL", digits: 0 };
}

function DashboardReady({ d }: { d: DashboardDto }) {
  const role = useRole();
  const go = useGo();
  const { kpis, period } = d;
  const vs = "vs " + period.prevLabel;
  const values = d.months.map((m) => chartValue(m.net));
  const max = Math.max(1, ...values);
  const scale = chartScale(max);
  const repMax = Math.max(1, ...d.reps.map((r) => chartValue(r.net)));
  const statusTotal = d.paymentStatus.reduce((s, x) => s + chartValue(x.grossAll), 0) || 1;
  const orderTotal = d.ordersByStatus.reduce((s, x) => s + x.count, 0) || 1;
  const partial = d.months.find((m) => m.partial);
  const statusLabel = (b: (typeof d.paymentStatus)[number]["bucket"]): BadgeLabel => (b === "OVERDUE" ? "Overdue" : INVOICE_PAYMENT_STATUS_LABEL[b]);

  return (
    <>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
        <KpiCard
          label="Invoiced sales"
          icon="invoices"
          value={formatWholeDecimal(kpis.invoicedNet.value)}
          unit="ALL"
          delta={delta(kpis.invoicedNet.value, kpis.invoicedNet.previous, vs)}
          sub={`${period.label} · net of VAT`}
          title={`${all(kpis.invoicedNet.value)} net, ${all(kpis.invoicedNet.gross)} gross, ${kpis.invoicedNet.invoices} issued invoices`}
        />
        <KpiCard
          label="Orders"
          icon="orders"
          value={String(kpis.orders.value)}
          delta={delta(kpis.orders.value, kpis.orders.previous, vs)}
          sub={`${period.label} · excl. cancelled · pipeline ${formatWholeDecimal(kpis.pipeline.value)} ALL`}
          title={`Pipeline: ${kpis.pipeline.orders} confirmed orders not yet invoiced, ${all(kpis.pipeline.value)}`}
        />
        <KpiCard
          label="Active customers"
          icon="customers"
          value={String(kpis.activeCustomers.value)}
          sub={`${kpis.activeCustomers.orderedInPeriod} ordered in this period${role.scopedToOwnCustomers ? " · your customers" : ""}`}
        />
        <KpiCard
          label="Outstanding receivables"
          icon="payments"
          value={formatWholeDecimal(kpis.receivables.outstanding)}
          unit="ALL"
          sub={`${kpis.receivables.openInvoices} open invoices · ${kpis.receivables.overdueInvoices} overdue (${formatWholeDecimal(kpis.receivables.overdue)} ALL)`}
          title={`As of ${formatDate(d.asOf)}: ${all(kpis.receivables.outstanding)} outstanding, ${all(kpis.receivables.overdue)} overdue`}
        />
      </div>

      <div className={GRID_2}>
        <Panel className="gap-[14px]">
          <PanelHeader
            title="Invoiced revenue by month"
            note={`Net of VAT · ${scale.unit}${partial ? ` · *${MONTHS[Number(partial.month.slice(5)) - 1]} to date` : ""}`}
          />
          <div className="flex h-[200px] items-end gap-2 border-b border-divider pt-2" role="img" aria-label={`Invoiced revenue by month, ${period.to.slice(0, 4)}, bar chart`}>
            {d.months.map((m, i, list) => (
              <div
                key={m.month}
                title={`${MONTHS[i]} ${m.month.slice(0, 4)}: ${all(m.net)} net${m.partial ? " (month to date)" : ""}`}
                className="flex h-full min-w-0 flex-1 flex-col items-stretch justify-end gap-1"
              >
                <span className="text-center text-[10.5px] text-neutral-700 tabular-nums">{(values[i] / scale.div).toFixed(scale.digits)}</span>
                <div
                  className="max-h-[85%]"
                  style={{
                    height: Math.max(2, Math.round((values[i] / max) * 100)) + "%",
                    background: i === list.length - 1 ? "var(--color-accent-800)" : i === list.length - 2 ? "var(--color-accent-600)" : "var(--color-accent-400)",
                  }}
                />
              </div>
            ))}
          </div>
          <div className="-mt-2 flex gap-2">
            {d.months.map((m, i) => (
              <span key={m.month} className="min-w-0 flex-1 text-center text-[11px] text-neutral-700">
                {MONTHS[i]}
                {m.partial ? "*" : ""}
              </span>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-[10px] border-t border-divider pt-2">
            <PanelHeader as="h4" title="Orders by status" note={`${period.label} · by order date`} />
            <div className="flex h-3 gap-[2px]">
              {d.ordersByStatus
                .filter((x) => x.count)
                .map((x) => (
                  <div
                    key={x.status}
                    title={`${ORDER_STATUS_LABEL[x.status]}: ${x.count} orders, ${all(x.valueAll)}`}
                    style={{ width: ((x.count / orderTotal) * 100).toFixed(1) + "%", background: statusColor(ORDER_STATUS_LABEL[x.status]) }}
                  />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-[6px] sm:grid-cols-3">
              {d.ordersByStatus.map((x) => (
                <div key={x.status} className="flex items-center gap-2 text-[12.5px]" title={`${x.count} orders, ${all(x.valueAll)}`}>
                  <span className="h-[10px] w-[10px] flex-none" style={{ background: statusColor(ORDER_STATUS_LABEL[x.status]) }} />
                  <span className="flex-1">{ORDER_STATUS_LABEL[x.status]}</span>
                  <span className="tabular-nums">{x.count}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="gap-[14px]">
          <PanelHeader title="Sales by representative" note={`${period.label} · net ALL`} />
          <div className="flex flex-col gap-3">
            {d.reps.length === 0 ? <p className="text-muted m-0 text-[13px]">No invoices issued in this period.</p> : null}
            {d.reps.map((r) => (
              <div key={r.id} className="grid grid-cols-[120px_minmax(0,1fr)_92px] items-center gap-[10px] text-[13px]" title={`${r.name}: ${all(r.net)} net, ${r.invoices} invoices`}>
                <span>{r.name}</span>
                <div className="h-3 bg-neutral-200">
                  <div className="h-full bg-accent" style={{ width: Math.round((chartValue(r.net) / repMax) * 100) + "%" }} />
                </div>
                <span className="text-right tabular-nums">{formatWholeDecimal(r.net)}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-[10px] border-t border-divider pt-2">
            <PanelHeader as="h4" title="Invoice payment status" note="By gross value, all open periods" />
            <div className="flex h-3 gap-[2px]">
              {d.paymentStatus.map((x) => (
                <div
                  key={x.bucket}
                  title={`${statusLabel(x.bucket)}: ${x.count} invoices, ${all(x.grossAll)}`}
                  style={{ width: ((chartValue(x.grossAll) / statusTotal) * 100).toFixed(1) + "%", background: statusColor(statusLabel(x.bucket)) }}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-[6px]">
              {d.paymentStatus.map((x) => (
                <div key={x.bucket} className="flex items-center gap-2 text-[12.5px]" title={all(x.grossAll)}>
                  <span className="h-[10px] w-[10px] flex-none" style={{ background: statusColor(statusLabel(x.bucket)) }} />
                  <span className="flex-1">
                    {statusLabel(x.bucket)} <span className="text-neutral-700">({x.count})</span>
                  </span>
                  <span className="tabular-nums">{formatWholeDecimal(x.grossAll)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className={GRID_2}>
        <Panel className="gap-[10px]">
          <PanelHeader title="Top products" note={`${period.label} · net ALL`} />
          <table className="table">
            <thead>
              <tr>
                <th className="w-7">#</th>
                <th>Product</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Net sales</th>
              </tr>
            </thead>
            <tbody>
              {d.topProducts.map((p, i) => (
                <tr key={p.id}>
                  <td className="text-neutral-700">{i + 1}</td>
                  <td>{p.name}</td>
                  <td className="num whitespace-nowrap">
                    {formatDecimal(p.quantity, 0, 3)} {p.unit}
                  </td>
                  <td className="num" title={all(p.net)}>
                    {formatWholeDecimal(p.net)}
                  </td>
                </tr>
              ))}
              {d.topProducts.length === 0 ? <EmptyRow cols={4} /> : null}
            </tbody>
          </table>
        </Panel>
        <Panel className="gap-[10px]">
          <PanelHeader title="Top customers" note={`${period.label} · net ALL`} />
          <table className="table">
            <thead>
              <tr>
                <th className="w-7">#</th>
                <th>Customer</th>
                <th>City</th>
                <th className="text-right">Net sales</th>
              </tr>
            </thead>
            <tbody>
              {d.topCustomers.map((c, i) => (
                <tr key={c.id} className="clickable" onClick={() => go.customer(c.id)}>
                  <td className="text-neutral-700">{i + 1}</td>
                  <td className="font-medium">{c.name}</td>
                  <td>{c.city}</td>
                  <td className="num" title={all(c.net)}>
                    {formatWholeDecimal(c.net)}
                  </td>
                </tr>
              ))}
              {d.topCustomers.length === 0 ? <EmptyRow cols={4} /> : null}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className={GRID_2}>
        <RecentTable title="Recent orders" head={["Order", "Customer", "Date", "Total", "Status"]}>
          {d.recent.orders.map((o) => (
            <tr key={o.id} className="clickable" onClick={() => go.order(o.id)}>
              <td className="font-medium whitespace-nowrap">{o.orderNumber}</td>
              <td>{o.customer}</td>
              <td className="whitespace-nowrap">{formatDate(o.orderDate)}</td>
              <Amount value={o.total} currency={o.currencyCode} />
              <td>
                <span className="inline-flex flex-wrap gap-1">
                  <StatusBadge label={ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL]} bordered />
                  {o.invoiced ? <StatusBadge label="Invoiced" /> : null}
                </span>
              </td>
            </tr>
          ))}
          {d.recent.orders.length === 0 ? <EmptyRow cols={5} /> : null}
        </RecentTable>
        <RecentTable title="Recently issued invoices" head={["Invoice", "Customer", "Issued", "Total", "Status"]}>
          {d.recent.invoices.map((i) => (
            <tr key={i.id} className="clickable" onClick={() => go.invoice(i.id)}>
              <td className="font-medium whitespace-nowrap">{i.invoiceNumber}</td>
              <td>{i.customer}</td>
              <td className="whitespace-nowrap">{formatDate(i.issueDate)}</td>
              <Amount value={i.total} currency={i.currencyCode} />
              <td>
                <InvoiceStatusBadges paymentStatus={i.paymentStatus} overdue={i.overdue} />
              </td>
            </tr>
          ))}
          {d.recent.invoices.length === 0 ? <EmptyRow cols={5} /> : null}
        </RecentTable>
        <RecentTable title="Outstanding invoices" head={["Invoice", "Customer", "Due", "Outstanding", "Status"]}>
          {d.recent.outstanding.map((i) => (
            <tr key={i.id} className="clickable" onClick={() => go.invoice(i.id)}>
              <td className="font-medium whitespace-nowrap">{i.invoiceNumber}</td>
              <td>{i.customer}</td>
              <td className="whitespace-nowrap">{formatDate(i.dueDate)}</td>
              <Amount value={i.outstanding} currency={i.currencyCode} />
              <td>
                <InvoiceStatusBadges paymentStatus={i.paymentStatus} overdue={i.overdue} />
              </td>
            </tr>
          ))}
          {d.recent.outstanding.length === 0 ? <EmptyRow cols={5} /> : null}
        </RecentTable>
        <RecentTable
          title="Recent payments"
          note={`Collected in this period: ${formatWholeDecimal(kpis.collected.amount)} ALL`}
          head={["Reference", "Invoice", "Date", "Method", "Amount"]}
        >
          {d.recent.payments.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => go.invoice(p.invoiceId)}>
              <td className="whitespace-nowrap">{p.reference ?? <span className="text-muted">—</span>}</td>
              <td className="font-medium whitespace-nowrap">{p.invoiceNumber}</td>
              <td className="whitespace-nowrap">{formatDate(p.paymentDate)}</td>
              <td>{PAYMENT_METHOD_LABEL[p.method]}</td>
              <Amount value={p.amount} currency={p.currencyCode} />
            </tr>
          ))}
          {d.recent.payments.length === 0 ? <EmptyRow cols={5} /> : null}
        </RecentTable>
      </div>
    </>
  );
}

/** Original-currency amount with a muted currency code (the design's money cell). */
function Amount({ value, currency }: { value: string; currency: string }) {
  return (
    <td className="num whitespace-nowrap">
      {formatDecimal(value, 2, 2)} <span className="cur-suffix">{currency}</span>
    </td>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="text-muted text-center text-[13px]">
        Nothing yet.
      </td>
    </tr>
  );
}

function KpiCard({ label, icon, value, unit, sub, delta, title }: { label: string; icon: IconName; value: string; unit?: string; sub: string; delta?: Delta | null; title?: string }) {
  return (
    <Blueprint className="flex min-w-0 flex-col gap-[6px] px-[18px] py-4" title={title}>
      <div className="flex items-start justify-between gap-2">
        <span className="kicker">{label}</span>
        <span className="text-accent">
          <Icon name={icon} size={20} />
        </span>
      </div>
      <div className="flex items-baseline gap-[6px]">
        <span className="font-heading text-[34px] leading-none font-semibold tabular-nums">{value}</span>
        {unit ? <span className="text-[13px] text-neutral-700">{unit}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-700">
        {delta ? (
          <>
            <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${delta.pct >= 0 ? "text-success-700" : "text-danger-700"}`}>
              <Icon name={delta.pct >= 0 ? "up" : "down"} />
              {delta.text}
            </span>
            <span>{delta.label}</span>
          </>
        ) : null}
        <span>{sub}</span>
      </div>
    </Blueprint>
  );
}

function RecentTable({ title, note, head, children }: { title: string; note?: ReactNode; head: string[]; children: ReactNode }) {
  return (
    <Panel className="gap-[10px]">
      {note ? <PanelHeader title={title} note={note} /> : <h3 className="panel-title">{title}</h3>}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className={h === "Total" || h === "Outstanding" || h === "Amount" ? "text-right" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Panel>
  );
}
