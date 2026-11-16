"use client";

import { useMemo, useState } from "react";
import { API_ENDPOINTS } from "@/services/api";
import { formatDate, formatMoney } from "@/lib/money";
import { CURRENCIES } from "@/lib/types";
import { useActions, usePreview } from "@/store/preview-store";
import { listState, useRole, useScopedData } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { CurrencyTotals, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { useGo } from "@/components/layout/use-go";

export function PaymentsView() {
  const { payments, customerById } = useScopedData();
  const dataState = usePreview((s) => s.dataState);
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return payments.filter(
      (p) => !t || p.reference.toLowerCase().includes(t) || p.invoiceId.toLowerCase().includes(t) || customerById[p.customerId].name.toLowerCase().includes(t),
    );
  }, [payments, customerById, q]);

  const state = listState(dataState, filtered, "payments", API_ENDPOINTS.payments);
  const totals = CURRENCIES.map((cur) => {
    const rows = filtered.filter((p) => p.currency === cur);
    if (!rows.length) return null;
    return { cur, label: `${rows.length} ${rows.length === 1 ? "payment" : "payments"} ·`, value: formatMoney(rows.reduce((a, p) => a + p.amount, 0), cur) };
  }).filter((t) => t !== null);

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Payments received against invoices, in the invoice currency."
        actions={
          role.canRegisterPayments ? (
            <Button variant="primary" icon="plus" onClick={() => actions.openPayment()}>
              Register payment
            </Button>
          ) : null
        }
      />
      <ListPanel
        state={state}
        onClear={() => setQ("")}
        clearLabel="Clear search"
        filters={
          <input
            className="input w-[280px] max-w-full"
            type="search"
            aria-label="Search payments"
            placeholder="Reference, invoice or customer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Reference</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Method</th>
                <th className="text-right">Amount</th>
                <th>Cur.</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => go.invoice(p.invoiceId)}>
                  <td className="whitespace-nowrap text-neutral-700">{p.id}</td>
                  <td className="font-medium whitespace-nowrap">{p.reference}</td>
                  <td className="whitespace-nowrap">{p.invoiceId}</td>
                  <td>{customerById[p.customerId].name}</td>
                  <td className="whitespace-nowrap">{formatDate(p.date)}</td>
                  <td>{p.method}</td>
                  <td className="num whitespace-nowrap">{formatMoney(p.amount)}</td>
                  <td>{p.currency}</td>
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
