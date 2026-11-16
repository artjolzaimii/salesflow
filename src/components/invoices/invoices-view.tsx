"use client";

import { useMemo, useState } from "react";
import { API_ENDPOINTS } from "@/services/api";
import { formatDate, formatMoney } from "@/lib/money";
import { CURRENCIES } from "@/lib/types";
import { useActions, usePreview } from "@/store/preview-store";
import { listState, useRole, useScopedData } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { CurrencyTotals, FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";

const BLANK = { q: "", status: "all", currency: "all", from: "", to: "" };

export function InvoicesView() {
  const { invoices, customerById } = useScopedData();
  const dataState = usePreview((s) => s.dataState);
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const [f, setF] = useState(BLANK);
  const set = (k: keyof typeof BLANK, v: string) => setF((x) => ({ ...x, [k]: v }));

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return invoices.filter(
      (i) =>
        (!q || i.id.toLowerCase().includes(q) || customerById[i.customerId].name.toLowerCase().includes(q)) &&
        (f.status === "all" || i.status === f.status) &&
        (f.currency === "all" || i.currency === f.currency) &&
        (!f.from || i.issueDate >= f.from) &&
        (!f.to || i.issueDate <= f.to),
    );
  }, [invoices, customerById, f]);

  const state = listState(dataState, filtered, "invoices", API_ENDPOINTS.invoices);
  const totals = CURRENCIES.map((cur) => {
    const rows = filtered.filter((i) => i.currency === cur);
    if (!rows.length) return null;
    return {
      cur,
      label: `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} · total ${formatMoney(rows.reduce((a, i) => a + i.total, 0), cur)} ·`,
      value: `open ${formatMoney(rows.reduce((a, i) => a + i.outstanding, 0), cur)}`,
    };
  }).filter((t) => t !== null);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Issued invoices are immutable. Payment status is derived from payments and the due date."
        actions={
          role.canRegisterPayments ? (
            <Button icon="plus" onClick={() => actions.openPayment()}>
              Register payment
            </Button>
          ) : null
        }
      />
      <ListPanel
        state={state}
        onClear={() => setF(BLANK)}
        filters={
          <FilterRow>
            <input className="input w-[240px] max-w-full" type="search" aria-label="Search invoices" placeholder="Invoice number or customer" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="Payment status" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="all">All payment statuses</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Paid</option>
              <option value="Overdue">Overdue</option>
            </select>
            <select className="input w-auto" aria-label="Currency" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="all">All currencies</option>
              <option value="ALL">ALL</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
            <div className="flex items-center gap-[6px] text-[13px] text-neutral-700">
              <span>Issued</span>
              <input className="input w-auto" type="date" aria-label="Issued from" value={f.from} onChange={(e) => set("from", e.target.value)} />
              <span>to</span>
              <input className="input w-auto" type="date" aria-label="Issued to" value={f.to} onChange={(e) => set("to", e.target.value)} />
            </div>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[960px]">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Cur.</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Outstanding</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => go.invoice(i.id)}>
                  <td className="font-medium whitespace-nowrap">{i.id}</td>
                  <td>{customerById[i.customerId].name}</td>
                  <td className="whitespace-nowrap">{formatDate(i.issueDate)}</td>
                  <td className="whitespace-nowrap">{formatDate(i.dueDate)}</td>
                  <td>{i.currency}</td>
                  <td className="num whitespace-nowrap">{formatMoney(i.total)}</td>
                  <td className="num whitespace-nowrap text-neutral-700">{formatMoney(i.paid)}</td>
                  <td className="num font-medium whitespace-nowrap">{formatMoney(i.outstanding)}</td>
                  <td>
                    <StatusBadge label={i.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CurrencyTotals items={totals} />
      </ListPanel>
    </>
  );
}
