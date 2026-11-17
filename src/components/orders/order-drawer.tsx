"use client";

import { formatDate, formatRate } from "@/lib/money";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole, useScopedData } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Drawer, KeyValues } from "@/components/ui/overlay";
import { StatusBadge } from "@/components/ui/status-badge";
import { FinancialSummary, ItemsTable } from "@/components/sales/document-parts";
import { useGo } from "@/components/layout/use-go";

/** Order detail drawer with preview status transitions (confirm, invoice, cancel). */
export function OrderDrawer() {
  const id = usePreview((s) => s.orderDrawerId);
  const allInvoices = usePreview((s) => s.data.invoices);
  const { orders, customerById, repName } = useScopedData();
  const role = useRole();
  const actions = useActions();
  const go = useGo();

  const order = id ? orders.find((o) => o.id === id) : undefined;
  if (!order) return null;

  const c = customerById[order.customerId];
  const invoice = allInvoices.find((i) => i.orderId === order.id);
  // Same transition table the server and database enforce (src/lib/order-status.ts).
  const live = order.status !== "Draft" && order.status !== "Cancelled";
  const confirmed = live;
  const canConfirm = order.status === "Draft" && role.canCreateOrders;
  const canInvoice = live && !invoice && role.canIssueInvoices;
  const nextStep = order.status === "Confirmed" ? "Processing" : order.status === "Processing" ? "Delivered" : null;
  const canAdvance = !!nextStep && role.canFulfilOrders;
  // An order with an issued invoice cannot be cancelled; cancel the invoice first.
  const canCancel = (order.status === "Draft" || order.status === "Confirmed" || order.status === "Processing") && !invoice && role.canCancelOrders;
  const reached = (s: "Processing" | "Delivered") => order.status === s || (s === "Processing" && order.status === "Delivered");
  const timeline = [
    { t: "Created", d: formatDate(order.date), done: true },
    { t: "Confirmed", d: confirmed ? formatDate(order.date) : "Pending", done: confirmed },
    { t: "Processing", d: reached("Processing") ? "Done" : "Pending", done: reached("Processing") },
    { t: "Delivered", d: reached("Delivered") ? "Done" : "Pending", done: reached("Delivered") },
    { t: "Invoiced", d: invoice ? formatDate(invoice.issueDate) : "Pending", done: !!invoice },
  ];

  return (
    <Drawer
      label="Order details"
      width={560}
      onClose={actions.closeOrder}
      header={
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-[10px]">
            <h2 className="m-0 text-[26px]">{order.id}</h2>
            <StatusBadge label={order.status} bordered />
            {invoice ? <StatusBadge label="Invoiced" /> : null}
          </div>
          <span className="text-[13px] text-neutral-700">
            {c.name} · {formatDate(order.date)}
          </span>
        </div>
      }
    >
      {canConfirm || canInvoice || canAdvance || canCancel ? (
        <div className="flex flex-wrap gap-2">
          {canConfirm ? (
            <Button variant="primary" icon="check" onClick={() => actions.confirmOrder(order.id)}>
              Confirm order
            </Button>
          ) : null}
          {canInvoice ? (
            <Button
              variant="primary"
              icon="invoices"
              onClick={() =>
                actions.askConfirm({
                  title: `Issue invoice for ${order.id}?`,
                  body: "Issuing freezes all amounts, VAT and the exchange rate. Corrections afterwards require a credit note.",
                  action: "Issue invoice",
                  run: () => actions.issueInvoice(order.id),
                })
              }
            >
              Issue invoice
            </Button>
          ) : null}
          {canAdvance && nextStep ? (
            <Button icon="check" onClick={() => actions.advanceOrder(order.id, nextStep)}>
              Mark as {nextStep.toLowerCase()}
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              onClick={() =>
                actions.askConfirm({
                  title: `Cancel ${order.id}?`,
                  body: "The order stays on record with status Cancelled for audit. This cannot be undone.",
                  action: "Cancel order",
                  run: () => actions.cancelOrder(order.id),
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
          ["Customer", `${c.name} · ${c.nipt}`],
          ["Representative", repName(order.repId)],
          ["Delivery", order.deliveryAddress],
          ["Currency", order.currency],
          ["Exchange rate", <span key="r" className="tabular-nums">{formatRate(order.currency, order.exchangeRate)}</span>],
          [
            "Invoice",
            invoice ? (
              <a
                key="i"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  go.invoice(invoice.id);
                }}
              >
                {invoice.id}
              </a>
            ) : order.status === "Cancelled" ? (
              <span key="n" className="text-muted">Not applicable</span>
            ) : null,
          ],
        ]}
      />

      <ItemsTable order={order} />
      <FinancialSummary totals={order} currency={order.currency} rate={order.exchangeRate} />

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-[16px]">Timeline</h4>
        {timeline.map((t) => (
          <div key={t.t} className="flex items-center gap-[10px] text-[13px]">
            <span className={`h-[10px] w-[10px] flex-none border border-accent ${t.done ? "bg-accent" : "bg-transparent"}`} />
            <span className="w-[90px]">{t.t}</span>
            <span className="text-muted">{t.d}</span>
          </div>
        ))}
        <span className="text-[11.5px] text-neutral-700">Status events from the order audit log, where the backend records them.</span>
      </div>
    </Drawer>
  );
}
