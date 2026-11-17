"use client";

import { useState } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { option, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { PaymentPage } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { useActions } from "@/store/preview-store";
import { apiListState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { SelectOptions } from "@/components/ui/field";
import { CurrencyTotals, FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { useGo } from "@/components/layout/use-go";

const PAGE_SIZE = 10;
const BLANK = { q: "", method: "all", currency: "all", from: "", to: "" };

/** Payments from GET /api/payments. Rows open the invoice, which holds the full payment history. */
export function PaymentsView() {
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const q = useDebounced(f.q.trim());
  const set = (k: keyof typeof BLANK, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  const list = useApiQuery<PaymentPage>("/api/payments" + qs({ q, method: f.method, currency: f.currency, from: f.from, to: f.to, page: page + 1, pageSize: PAGE_SIZE }));
  const filtered = !!q || f.method !== "all" || f.currency !== "all" || !!f.from || !!f.to;
  const state = apiListState(list, list.data?.items ?? [], "payments", filtered);
  const totals = (list.data?.totals ?? []).map((t) => ({
    cur: t.currencyCode,
    label: `${t.count} ${t.count === 1 ? "payment" : "payments"} ·`,
    value: formatDecimal(t.amount, 2, 2),
  }));

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
        onClear={() => {
          setF(BLANK);
          setPage(0);
        }}
        filters={
          <FilterRow>
            <input
              className="input w-[280px] max-w-full"
              type="search"
              aria-label="Search payments"
              placeholder="Reference, invoice or customer"
              value={f.q}
              onChange={(e) => set("q", e.target.value)}
            />
            <select className="input w-auto" aria-label="Payment method" value={f.method} onChange={(e) => set("method", e.target.value)}>
              <option value="all">All methods</option>
              <SelectOptions options={option(PAYMENT_METHOD_LABEL)} />
            </select>
            <select className="input w-auto" aria-label="Currency" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="all">All currencies</option>
              <option value="ALL">ALL</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
            <div className="flex items-center gap-[6px] text-[13px] text-neutral-700">
              <span>Paid</span>
              <input className="input w-auto" type="date" aria-label="Paid from" value={f.from} onChange={(e) => set("from", e.target.value)} />
              <span>to</span>
              <input className="input w-auto" type="date" aria-label="Paid to" value={f.to} onChange={(e) => set("to", e.target.value)} />
            </div>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Method</th>
                <th className="text-right">Amount</th>
                <th>Cur.</th>
                {role.canRegisterPayments ? <th>Recorded by</th> : null}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => go.invoice(p.invoiceId)}>
                  <td className="font-medium whitespace-nowrap">{p.reference ?? <span className="text-muted font-normal">No reference</span>}</td>
                  <td className="whitespace-nowrap">{p.invoiceNumber}</td>
                  <td>{p.customer.businessName}</td>
                  <td className="whitespace-nowrap">{formatDate(p.paymentDate)}</td>
                  <td>{PAYMENT_METHOD_LABEL[p.method]}</td>
                  <td className="num whitespace-nowrap">{formatDecimal(p.amount, 2, 2)}</td>
                  <td>{p.currencyCode}</td>
                  {role.canRegisterPayments ? <td className="whitespace-nowrap">{p.recordedBy ?? <span className="text-muted">Not recorded</span>}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} size={PAGE_SIZE} onPage={setPage} />
        <CurrencyTotals items={totals} />
      </ListPanel>
    </>
  );
}
