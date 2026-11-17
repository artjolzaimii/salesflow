"use client";

import { useState } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { INVOICE_STATUS_FILTER_LABEL, type InvoiceStatusFilter } from "@/lib/invoice-status";
import { option } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { InvoicePage } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { useActions } from "@/store/preview-store";
import { apiListState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { SelectOptions } from "@/components/ui/field";
import { CurrencyTotals, FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { useGo } from "@/components/layout/use-go";
import { InvoiceStatusBadges } from "./invoice-badges";

const PAGE_SIZE = 10;
const BLANK = { q: "", status: "all" as InvoiceStatusFilter | "all", currency: "all", from: "", to: "" };

/** Invoices from GET /api/invoices; payment status is derived on the server from payments and the due date. */
export function InvoicesView() {
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const q = useDebounced(f.q.trim());
  const set = <K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  const list = useApiQuery<InvoicePage>(
    "/api/invoices" + qs({ q, status: f.status, currency: f.currency, from: f.from, to: f.to, page: page + 1, pageSize: PAGE_SIZE }),
  );
  const filtered = !!q || f.status !== "all" || f.currency !== "all" || !!f.from || !!f.to;
  const state = apiListState(list, list.data?.items ?? [], "invoices", filtered);
  const totals = (list.data?.totals ?? []).map((t) => ({
    cur: t.currencyCode,
    label: `${t.count} ${t.count === 1 ? "invoice" : "invoices"} · total ${formatDecimal(t.total, 2, 2)} ·`,
    value: `open ${formatDecimal(t.outstanding, 2, 2)}`,
  }));

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
        onClear={() => {
          setF(BLANK);
          setPage(0);
        }}
        filters={
          <FilterRow>
            <input className="input w-[240px] max-w-full" type="search" aria-label="Search invoices" placeholder="Invoice, order, customer or NIPT" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="Payment status" value={f.status} onChange={(e) => set("status", e.target.value as InvoiceStatusFilter | "all")}>
              <option value="all">All payment statuses</option>
              <SelectOptions options={option(INVOICE_STATUS_FILTER_LABEL)} />
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
                  <td className="font-medium whitespace-nowrap">
                    {i.invoiceNumber}
                    {i.isReplacement ? <div className="text-[11.5px] font-normal text-neutral-700">Replacement</div> : null}
                  </td>
                  <td>{i.customer.businessName}</td>
                  <td className="whitespace-nowrap">{formatDate(i.issueDate)}</td>
                  <td className="whitespace-nowrap">{formatDate(i.dueDate)}</td>
                  <td>{i.currencyCode}</td>
                  <td className={`num whitespace-nowrap ${i.status === "CANCELLED" ? "text-neutral-700 line-through" : ""}`}>{formatDecimal(i.total, 2, 2)}</td>
                  <td className="num whitespace-nowrap text-neutral-700">{formatDecimal(i.paid, 2, 2)}</td>
                  <td className="num font-medium whitespace-nowrap">{formatDecimal(i.outstanding, 2, 2)}</td>
                  <td>
                    <InvoiceStatusBadges paymentStatus={i.paymentStatus} overdue={i.overdue} />
                  </td>
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
