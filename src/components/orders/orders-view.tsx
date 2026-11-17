"use client";

import { useMemo, useState } from "react";
import { API_ENDPOINTS } from "@/services/api";
import { formatDate, formatMoney } from "@/lib/money";
import { usePreview } from "@/store/preview-store";
import { listState, useRole, useScopedData } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { paginate, Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";

const PAGE_SIZE = 10;
const BLANK = { q: "", status: "all", currency: "all" };

export function OrdersView() {
  const { orders, customerById, repName } = useScopedData();
  const dataState = usePreview((s) => s.dataState);
  const role = useRole();
  const go = useGo();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const set = (k: keyof typeof BLANK, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (!q || o.id.toLowerCase().includes(q) || customerById[o.customerId].name.toLowerCase().includes(q)) &&
        (f.status === "all" || (f.status === "Invoiced" ? !!o.invoiceId : o.status === f.status)) &&
        (f.currency === "all" || o.currency === f.currency),
    );
  }, [orders, customerById, f]);

  const paged = paginate(filtered, page, PAGE_SIZE);
  const state = listState(dataState, paged.rows, "orders", API_ENDPOINTS.orders);

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
            <input className="input w-[260px] max-w-full" type="search" aria-label="Search orders" placeholder="Order number or customer" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="all">All statuses</option>
              <option value="Draft">Draft</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Processing">Processing</option>
              <option value="Delivered">Delivered</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Invoiced">Invoiced (any status)</option>
            </select>
            <select className="input w-auto" aria-label="Currency" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="all">All currencies</option>
              <option value="ALL">ALL</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
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
                  <td className="font-medium whitespace-nowrap">{o.id}</td>
                  <td>{customerById[o.customerId].name}</td>
                  <td>{repName(o.repId)}</td>
                  <td className="whitespace-nowrap">{formatDate(o.date)}</td>
                  <td>{o.currency}</td>
                  <td className="num whitespace-nowrap">{formatMoney(o.total)}</td>
                  <td>
                    <span className="inline-flex flex-wrap gap-1">
                      <StatusBadge label={o.status} bordered />
                      {o.invoiceId ? <StatusBadge label="Invoiced" /> : null}
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
        <Pager page={paged.page} pages={paged.pages} total={paged.total} size={PAGE_SIZE} onPage={setPage} />
      </ListPanel>
    </>
  );
}
