"use client";

import { useState } from "react";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { apiFetch, ApiError, errorMessage } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { InvoiceDetailDto, OrderDetailDto } from "@/services/client/types";
import { useActions, usePreview } from "@/store/preview-store";
import { Button } from "@/components/ui/button";
import { Drawer, KeyValues } from "@/components/ui/overlay";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { DecimalSummary, SnapshotItemsTable } from "@/components/sales/document-parts";
import { useGo } from "@/components/layout/use-go";
import { formatDecimal } from "@/lib/decimal-format";
import { paymentTermsDays } from "@/lib/labels";
import { refreshFinancials } from "@/components/invoices/invoice-badges";
import { DueDateDialog } from "@/components/invoices/invoice-dialogs";

/** Refetch everything that shows this order: lists, the detail, and the customer's history. */
export function refreshOrder(orderId: string, customerId?: string) {
  invalidate("/api/orders");
  invalidate(`/api/orders/${orderId}`);
  if (customerId) invalidate(`/api/customers/${customerId}`);
}

/** Order detail drawer from GET /api/orders/:id; every action is re-checked by the server. */
export function OrderDrawer() {
  const id = usePreview((s) => s.orderDrawerId);
  const actions = useActions();
  if (!id) return null;
  return (
    <Drawer label="Order details" width={560} onClose={actions.closeOrder} header={<OrderHeader id={id} />}>
      <OrderBody key={id} id={id} />
    </Drawer>
  );
}

function useOrder(id: string) {
  return useApiQuery<{ order: OrderDetailDto }>(`/api/orders/${encodeURIComponent(id)}`);
}

function OrderHeader({ id }: { id: string }) {
  const o = useOrder(id).data?.order;
  if (!o) return <h2 className="m-0 text-[26px]">Order</h2>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-[10px]">
        <h2 className="m-0 text-[26px]">{o.orderNumber}</h2>
        <StatusBadge label={ORDER_STATUS_LABEL[o.status]} bordered />
        {o.invoiced ? <StatusBadge label="Invoiced" /> : null}
      </div>
      <span className="text-[13px] text-neutral-700">
        {o.customer.businessName} · {formatDate(o.orderDate)}
      </span>
    </div>
  );
}

function OrderBody({ id }: { id: string }) {
  const q = useOrder(id);
  const actions = useActions();
  const go = useGo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issuing, setIssuing] = useState(false);

  if (q.loading) return <SkeletonRows />;
  if (!q.data) {
    return (
      <div className="flex flex-col gap-3">
        <AlertBanner>{q.error?.status === 404 ? "No accessible order has this ID. It may belong to another representative." : errorMessage(q.error)}</AlertBanner>
        {q.error?.status !== 404 ? (
          <Button className="self-start" onClick={q.refetch}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  const o = q.data.order;
  const can = o.actions;

  const run = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError("");
    try {
      await apiFetch(path, { method: "POST", body });
      actions.toast(done);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.code === "CONCURRENT_UPDATE") q.refetch();
    } finally {
      setBusy(false);
      refreshOrder(o.id, o.customer.id);
    }
  };
  const setStatus = (status: string, done: string) => run(`/api/orders/${o.id}/status`, { status, version: o.version }, done);

  const reached = (s: "CONFIRMED" | "PROCESSING" | "DELIVERED") => {
    const order = ["DRAFT", "CONFIRMED", "PROCESSING", "DELIVERED"];
    return o.status !== "CANCELLED" && order.indexOf(o.status) >= order.indexOf(s);
  };
  const timeline = [
    { t: "Created", d: formatDate(o.createdAt.slice(0, 10)), done: true },
    { t: "Confirmed", d: reached("CONFIRMED") ? "Done" : "Pending", done: reached("CONFIRMED") },
    { t: "Processing", d: reached("PROCESSING") ? "Done" : "Pending", done: reached("PROCESSING") },
    { t: "Delivered", d: reached("DELIVERED") ? "Done" : "Pending", done: reached("DELIVERED") },
    { t: "Invoiced", d: o.activeInvoice ? o.activeInvoice.invoiceNumber : "Pending", done: o.invoiced },
    ...(o.status === "CANCELLED" ? [{ t: "Cancelled", d: "Done", done: true }] : []),
  ];
  const delivery = o.delivery?.pickup
    ? "Pickup at warehouse"
    : o.delivery
      ? [o.delivery.label, o.delivery.street, o.delivery.city].filter(Boolean).join(", ")
      : "—";
  const anyAction = can.confirm || can.issueInvoice || can.markProcessing || can.markDelivered || can.edit || can.cancel;
  const latestInvoice = o.invoiceHistory[o.invoiceHistory.length - 1];

  return (
    <>
      {error ? <AlertBanner>{error}</AlertBanner> : null}
      {anyAction ? (
        <div className="flex flex-wrap gap-2">
          {can.confirm ? (
            <Button variant="primary" icon="check" disabled={busy} onClick={() => run(`/api/orders/${o.id}/confirm`, { version: o.version }, `${o.orderNumber} confirmed.`)}>
              Confirm order
            </Button>
          ) : null}
          {can.issueInvoice ? (
            <Button variant="primary" icon="invoices" disabled={busy} onClick={() => setIssuing(true)}>
              Issue invoice
            </Button>
          ) : null}
          {can.markProcessing ? (
            <Button icon="check" disabled={busy} onClick={() => setStatus("PROCESSING", `${o.orderNumber} marked as processing.`)}>
              Mark as processing
            </Button>
          ) : null}
          {can.markDelivered ? (
            <Button icon="check" disabled={busy} onClick={() => setStatus("DELIVERED", `${o.orderNumber} marked as delivered.`)}>
              Mark as delivered
            </Button>
          ) : null}
          {can.edit ? (
            <Button icon="edit" disabled={busy} onClick={() => go.to(ROUTES.editOrder(o.id))}>
              Edit order
            </Button>
          ) : null}
          {can.cancel ? (
            <Button
              disabled={busy}
              onClick={() =>
                actions.askConfirm({
                  title: `Cancel ${o.orderNumber}?`,
                  body: "The order stays on record with status Cancelled for audit. This cannot be undone.",
                  action: "Cancel order",
                  run: () => setStatus("CANCELLED", `${o.orderNumber} cancelled.`),
                })
              }
            >
              Cancel order
            </Button>
          ) : null}
        </div>
      ) : null}

      <KeyValues
        items={[
          [
            "Customer",
            <a
              key="c"
              href={ROUTES.customer(o.customer.id)}
              onClick={(e) => {
                e.preventDefault();
                go.customer(o.customer.id);
              }}
            >
              {o.customer.businessName} · {o.customer.nipt}
            </a>,
          ],
          ["Representative", o.salesRep.name],
          ["Delivery", delivery],
          ["Currency", o.currencyCode],
          [
            "Exchange rate",
            o.currencyCode === "ALL" ? (
              <span key="r" className="text-muted">
                Not applicable
              </span>
            ) : (
              <span key="r" className="tabular-nums">
                1 {o.currencyCode} = {o.rateText} ALL <span className="text-[12px] text-neutral-700">(stored on the order)</span>
              </span>
            ),
          ],
          [
            "Invoice",
            o.activeInvoice ? (
              <a
                key="i"
                href={ROUTES.invoices}
                onClick={(e) => {
                  e.preventDefault();
                  go.invoice(o.activeInvoice!.id);
                }}
              >
                {o.activeInvoice.invoiceNumber}
              </a>
            ) : latestInvoice ? (
              <a
                key="c"
                href={ROUTES.invoices}
                onClick={(e) => {
                  e.preventDefault();
                  go.invoice(latestInvoice.id);
                }}
              >
                {latestInvoice.invoiceNumber} (cancelled)
              </a>
            ) : o.status === "CANCELLED" ? (
              <span key="n" className="text-muted">
                Not applicable
              </span>
            ) : (
              <span key="p" className="text-muted">
                Not invoiced yet
              </span>
            ),
          ],
        ]}
      />
      {o.financiallyLocked ? (
        <p className="m-0 text-[12px] text-neutral-700">Invoiced orders are financially locked: amounts, rate and items can no longer change.</p>
      ) : null}

      <SnapshotItemsTable items={o.items} />
      <DecimalSummary totals={o.totals} currency={o.currencyCode} rateText={o.rateText} totalAll={o.grandTotalAll} />

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-[16px]">Timeline</h4>
        {timeline.map((t) => (
          <div key={t.t} className="flex items-center gap-[10px] text-[13px]">
            <span className={`h-[10px] w-[10px] flex-none border border-accent ${t.done ? "bg-accent" : "bg-transparent"}`} />
            <span className="w-[90px]">{t.t}</span>
            <span className="text-muted">{t.d}</span>
          </div>
        ))}
        <span className="text-[11.5px] text-neutral-700">Step dates appear once status history is recorded; the current status comes from the database.</span>
      </div>

      {issuing ? (
        <DueDateDialog
          title={`Issue invoice for ${o.orderNumber}`}
          intro={`${o.customer.businessName} · ${o.items.length} ${o.items.length === 1 ? "line" : "lines"}. The order's money, rate and items are locked once the invoice is issued.`}
          summary={
            <div className="text-[13px] tabular-nums">
              Total {formatDecimal(o.totals.grandTotal, 2, 2)} {o.currencyCode}
              {o.currencyCode !== "ALL" ? ` at 1 ${o.currencyCode} = ${o.rateText} ALL (stored on the order)` : ""}
            </div>
          }
          termsDays={paymentTermsDays(o.customer.businessSize)}
          submitLabel="Issue invoice"
          onClose={() => setIssuing(false)}
          onSubmit={async (dueDate) => {
            try {
              const res = await apiFetch<{ invoice: InvoiceDetailDto }>("/api/invoices", { method: "POST", body: { orderId: o.id, dueDate, version: o.version } });
              setIssuing(false);
              refreshFinancials({ customerId: o.customer.id });
              refreshOrder(o.id, o.customer.id);
              actions.toast(`Invoice ${res.invoice.invoiceNumber} issued for ${o.orderNumber}.`);
            } catch (e) {
              if (e instanceof ApiError && (e.code === "CONCURRENT_UPDATE" || e.code === "ORDER_ALREADY_INVOICED")) q.refetch();
              throw e;
            }
          }}
        />
      ) : null}
    </>
  );
}
