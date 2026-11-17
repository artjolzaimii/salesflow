"use client";

import { useMemo, type ReactNode } from "react";
import { dashboardSummary, type Delta } from "@/lib/analytics";
import { formatDate, formatWhole } from "@/lib/money";
import type { InvoiceView, Order, Payment } from "@/lib/types";
import { REVENUE_HISTORY } from "@/mocks/fixtures";
import { usePreview, useActions } from "@/store/preview-store";
import { useRole, useScopedData } from "@/store/hooks";
import { Blueprint, Panel, PanelHeader } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCards } from "@/components/ui/states";
import { StatusBadge, statusColor } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";
import { MoneyCell } from "@/components/sales/money-cell";

const GRID_2 = "grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]";

export function DashboardView() {
  const today = usePreview((s) => s.today);
  const dataState = usePreview((s) => s.dataState);
  const actions = useActions();

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`As of ${formatDate(today)}. Amounts in ALL; EUR and USD invoices converted at the rate recorded on each invoice.`}
      />
      {dataState === "loading" ? <SkeletonCards /> : null}
      {dataState === "error" ? (
        <Blueprint role="alert" className="flex items-start gap-[14px] p-7 text-danger-800">
          <Icon name="alert" />
          <div className="flex flex-col gap-[10px] text-text">
            <div className="font-medium">Dashboard data could not be loaded. GET /api/dashboard/summary returned 503.</div>
            <Button className="self-start" onClick={() => actions.toast("Retry refetches GET /api/dashboard/summary.")}>
              Retry
            </Button>
          </div>
        </Blueprint>
      ) : null}
      {dataState === "empty" ? (
        <Blueprint className="flex flex-col items-center gap-2 px-7 py-12 text-center">
          <h3 className="m-0">No sales activity yet</h3>
          <p className="text-muted m-0 max-w-[420px]">
            KPIs and charts fill in once the first invoice is issued. Start by registering a customer and creating an order.
          </p>
        </Blueprint>
      ) : null}
      {dataState === "ready" ? <DashboardReady /> : null}
    </>
  );
}

function DashboardReady() {
  const role = useRole();
  const scoped = useScopedData();
  const allOrders = usePreview((s) => s.data.orders);
  const products = usePreview((s) => s.data.products);
  const today = usePreview((s) => s.today);
  const go = useGo();

  const d = useMemo(
    () =>
      dashboardSummary({
        today,
        invoices: scoped.invoices,
        orders: scoped.orders,
        allOrders,
        customers: scoped.customers,
        products,
        employees: scoped.employees,
        history: (role.scopedToOwnCustomers ? REVENUE_HISTORY.rep : REVENUE_HISTORY.company).map((v) => v * 100000),
      }),
    [today, scoped, allOrders, products, role.scopedToOwnCustomers],
  );

  const { kpis, period } = d;
  const max = Math.max(...d.months.map((m) => m.value));
  const repMax = Math.max(1, ...d.repBars.map((r) => r.value));
  const open = scoped.invoices.filter((i) => i.outstanding > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const name = (id: string) => scoped.customerById[id].name;

  return (
    <>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
        <KpiCard label="Invoiced sales" icon="invoices" value={formatWhole(kpis.invoicedNet.value)} unit="ALL" delta={kpis.invoicedNet.delta} sub={`${period.label} · net of VAT`} />
        <KpiCard label="Orders" icon="orders" value={String(kpis.orders.value)} delta={kpis.orders.delta} sub={`${period.label} · excl. cancelled`} />
        <KpiCard label="Active customers" icon="customers" value={String(kpis.activeCustomers.value)} sub={`${kpis.activeCustomers.orderedThisMonth} ordered this month`} />
        <KpiCard
          label="Outstanding receivables"
          icon="payments"
          value={formatWhole(kpis.receivables.value)}
          unit="ALL"
          sub={`${kpis.receivables.open} open invoices · ${kpis.receivables.overdue} overdue`}
        />
      </div>

      <div className={GRID_2}>
        <Panel className="gap-[14px]">
          <PanelHeader title="Invoiced revenue by month" note="Net of VAT · millions ALL · *Nov month to date" />
          <div className="flex h-[200px] items-end gap-2 border-b border-divider pt-2" role="img" aria-label="Invoiced revenue by month, bar chart">
            {d.months.map((m, i, all) => (
              <div key={m.label} title={`${m.label.replace("*", "")} 2026: ${formatWhole(m.value)} ALL`} className="flex h-full min-w-0 flex-1 flex-col items-stretch justify-end gap-1">
                <span className="text-center text-[10.5px] text-neutral-700 tabular-nums">{(m.value / 1e8).toFixed(2)}</span>
                <div
                  className="max-h-[85%]"
                  style={{
                    height: Math.max(2, Math.round((m.value / max) * 100)) + "%",
                    background: i === all.length - 1 ? "var(--color-accent-800)" : i === all.length - 2 ? "var(--color-accent-600)" : "var(--color-accent-400)",
                  }}
                />
              </div>
            ))}
          </div>
          <div className="-mt-2 flex gap-2">
            {d.months.map((m) => (
              <span key={m.label} className="min-w-0 flex-1 text-center text-[11px] text-neutral-700">
                {m.label}
              </span>
            ))}
          </div>
        </Panel>

        <Panel className="gap-[14px]">
          <PanelHeader title="Sales by representative" note={`${period.label} · net ALL`} />
          <div className="flex flex-col gap-3">
            {d.repBars.map((r) => (
              <div key={r.name} className="grid grid-cols-[120px_minmax(0,1fr)_92px] items-center gap-[10px] text-[13px]">
                <span>{r.name}</span>
                <div className="h-3 bg-neutral-200">
                  <div className="h-full bg-accent" style={{ width: Math.round((r.value / repMax) * 100) + "%" }} />
                </div>
                <span className="text-right tabular-nums">{formatWhole(r.value)}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-[10px] border-t border-divider pt-2">
            <PanelHeader as="h4" title="Invoice payment status" note="By gross value, all open periods" />
            <div className="flex h-3 gap-[2px]">
              {d.distribution.map((x) => (
                <div key={x.status} title={x.status} style={{ width: x.share.toFixed(1) + "%", background: statusColor(x.status) }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-[6px]">
              {d.distribution.map((x) => (
                <div key={x.status} className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-[10px] w-[10px] flex-none" style={{ background: statusColor(x.status) }} />
                  <span className="flex-1">
                    {x.status} <span className="text-neutral-700">({x.count})</span>
                  </span>
                  <span className="tabular-nums">{formatWhole(x.amount)}</span>
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
                <tr key={p.name}>
                  <td className="text-neutral-700">{i + 1}</td>
                  <td>{p.name}</td>
                  <td className="num whitespace-nowrap">{p.quantity}</td>
                  <td className="num">{formatWhole(p.value)}</td>
                </tr>
              ))}
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
                <tr key={c.id}>
                  <td className="text-neutral-700">{i + 1}</td>
                  <td className="font-medium">{c.name}</td>
                  <td>{c.city}</td>
                  <td className="num">{formatWhole(c.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className={GRID_2}>
        <RecentTable title="Recent orders" head={["Order", "Customer", "Date", "Total", "Status"]}>
          {scoped.orders.slice(0, 5).map((o: Order) => (
            // Preview sample rows: not linked, since the order drawer now shows database orders only.
            <tr key={o.id}>
              <td className="font-medium whitespace-nowrap">{o.id}</td>
              <td>{name(o.customerId)}</td>
              <td className="whitespace-nowrap">{formatDate(o.date)}</td>
              <MoneyCell amount={o.total} currency={o.currency} />
              <td>
                <StatusBadge label={o.status} bordered />
              </td>
            </tr>
          ))}
        </RecentTable>
        <RecentTable title="Recently issued invoices" head={["Invoice", "Customer", "Issued", "Total", "Status"]}>
          {scoped.invoices.slice(0, 5).map((i: InvoiceView) => (
            <tr key={i.id} className="clickable" onClick={() => go.invoice(i.id)}>
              <td className="font-medium whitespace-nowrap">{i.id}</td>
              <td>{name(i.customerId)}</td>
              <td className="whitespace-nowrap">{formatDate(i.issueDate)}</td>
              <MoneyCell amount={i.total} currency={i.currency} />
              <td>
                <StatusBadge label={i.status} />
              </td>
            </tr>
          ))}
        </RecentTable>
        <RecentTable title="Outstanding invoices" head={["Invoice", "Customer", "Due", "Outstanding", "Status"]}>
          {open.slice(0, 5).map((i) => (
            <tr key={i.id} className="clickable" onClick={() => go.invoice(i.id)}>
              <td className="font-medium whitespace-nowrap">{i.id}</td>
              <td>{name(i.customerId)}</td>
              <td className="whitespace-nowrap">{formatDate(i.dueDate)}</td>
              <MoneyCell amount={i.outstanding} currency={i.currency} />
              <td>
                <StatusBadge label={i.status} />
              </td>
            </tr>
          ))}
        </RecentTable>
        <RecentTable title="Recent payments" head={["Reference", "Invoice", "Date", "Method", "Amount"]}>
          {scoped.payments.slice(0, 5).map((p: Payment) => (
            <tr key={p.id} className="clickable" onClick={() => go.invoice(p.invoiceId)}>
              <td className="whitespace-nowrap">{p.reference}</td>
              <td className="font-medium whitespace-nowrap">{p.invoiceId}</td>
              <td className="whitespace-nowrap">{formatDate(p.date)}</td>
              <td>{p.method}</td>
              <MoneyCell amount={p.amount} currency={p.currency} />
            </tr>
          ))}
        </RecentTable>
      </div>
    </>
  );
}

function KpiCard({ label, icon, value, unit, sub, delta }: { label: string; icon: IconName; value: string; unit?: string; sub: string; delta?: Delta | null }) {
  return (
    <Blueprint className="flex min-w-0 flex-col gap-[6px] px-[18px] py-4">
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

function RecentTable({ title, head, children }: { title: string; head: string[]; children: ReactNode }) {
  return (
    <Panel className="gap-[10px]">
      <h3 className="panel-title">{title}</h3>
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

