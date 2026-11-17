"use client";

import { useState } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { ORDER_STATUS_LABEL, option } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { EmployeePage, OrderPage } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { apiListState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { SelectOptions } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";

const PAGE_SIZE = 10;
const BLANK = { q: "", status: "all", currency: "all", rep: "all" };

/** Orders from GET /api/orders. Representatives receive their own sales and their customers' orders only. */
export function OrdersView() {
  const role = useRole();
  const go = useGo();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const q = useDebounced(f.q.trim());
  const set = (k: keyof typeof BLANK, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  const reps = useApiQuery<EmployeePage>(role.scopedToOwnCustomers ? null : "/api/employees?active=true&pageSize=100&sort=lastName");
  const list = useApiQuery<OrderPage>("/api/orders" + qs({ q, status: f.status, currency: f.currency, repId: f.rep, page: page + 1, pageSize: PAGE_SIZE }));
  const filtered = !!q || Object.entries(f).some(([k, v]) => k !== "q" && v !== "all");
  const state = apiListState(list, list.data?.items ?? [], "orders", filtered);

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Sales orders from draft through invoicing."
        actions={
          role.canCreateOrders ? (
            <Button variant="primary" icon="plus" onClick={() => go.newOrder()}>
              New order
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
            <input className="input w-[260px] max-w-full" type="search" aria-label="Search orders" placeholder="Order number, customer or NIPT" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="all">All statuses</option>
              <SelectOptions options={option(ORDER_STATUS_LABEL)} />
              <option value="INVOICED">Invoiced (any status)</option>
            </select>
            <select className="input w-auto" aria-label="Currency" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="all">All currencies</option>
              <option value="ALL">ALL</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
            {!role.scopedToOwnCustomers ? (
              <select className="input w-auto" aria-label="Representative" value={f.rep} onChange={(e) => set("rep", e.target.value)}>
                <option value="all">All representatives</option>
                <SelectOptions options={(reps.data?.items ?? []).map((e) => ({ value: e.id, label: e.name }))} />
              </select>
            ) : null}
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Representative</th>
                <th>Date</th>
                <th>Currency</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th className="w-[60px]" />
              </tr>
            </thead>
            <tbody>
              {state.rows.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => go.order(o.id)}>
                  <td className="font-medium whitespace-nowrap">{o.orderNumber}</td>
                  <td>{o.customer.businessName}</td>
                  <td>{o.salesRep.name}</td>
                  <td className="whitespace-nowrap">{formatDate(o.orderDate)}</td>
                  <td>{o.currencyCode}</td>
                  <td className="num whitespace-nowrap">{formatDecimal(o.grandTotal, 2, 2)}</td>
                  <td>
                    <span className="inline-flex flex-wrap gap-1">
                      <StatusBadge label={ORDER_STATUS_LABEL[o.status]} bordered />
                      {o.invoiced ? <StatusBadge label="Invoiced" /> : null}
                    </span>
                  </td>
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      className="text-[13px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        go.order(o.id);
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} size={PAGE_SIZE} onPage={setPage} />
      </ListPanel>
    </>
  );
}
