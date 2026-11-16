"use client";

import type { ReactNode } from "react";
import { formatDate, formatMoney, formatRate } from "@/lib/money";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole, useScopedData } from "@/store/hooks";
import { Blueprint } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Drawer, KeyValues } from "@/components/ui/overlay";
import { StatusBadge } from "@/components/ui/status-badge";
import { FinancialSummary, ItemsTable } from "@/components/sales/document-parts";
import { useGo } from "@/components/layout/use-go";

function Figure({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <Blueprint className={`px-3 py-[10px] ${highlight ? "border-accent" : ""}`}>
      <div className="text-[11px] text-neutral-700">{label}</div>
      <div className="font-heading text-[19px] font-semibold tabular-nums">{value}</div>
    </Blueprint>
  );
}

/** Read-only invoice detail: issued values are immutable. */
export function InvoiceDrawer() {
  const id = usePreview((s) => s.invoiceDrawerId);
  const products = usePreview((s) => s.data.products);
  const allOrders = usePreview((s) => s.data.orders);
  const allPayments = usePreview((s) => s.data.payments);
  const { invoices, customerById } = useScopedData();
  const role = useRole();
  const actions = useActions();
  const go = useGo();

  const inv = id ? invoices.find((i) => i.id === id) : undefined;
  if (!inv) return null;

  const c = customerById[inv.customerId];
  const order = allOrders.find((o) => o.id === inv.orderId);
  const pays = allPayments.filter((p) => p.invoiceId === inv.id);

  return (
    <Drawer
      label="Invoice details"
      width={580}
      onClose={actions.closeInvoice}
      header={
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-[10px]">
            <h2 className="m-0 text-[26px]">{inv.id}</h2>
            <StatusBadge label={inv.status} />
          </div>
          <span className="flex items-center gap-[6px] text-[12px] text-neutral-700">
            <Icon name="lock" size={14} />
            Issued values are locked. Corrections require a credit note.
          </span>
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-[14px]">
        <Figure label={`Total (${inv.currency})`} value={formatMoney(inv.total, inv.currency)} />
        <Figure label="Paid" value={formatMoney(inv.paid, inv.currency)} />
        <Figure label="Outstanding" value={formatMoney(inv.outstanding, inv.currency)} highlight />
      </div>

      {role.canRegisterPayments && inv.outstanding > 0 ? (
        <Button variant="primary" icon="plus" className="self-start" onClick={() => actions.openPayment(inv.id)}>
          Register payment
        </Button>
      ) : null}

      <KeyValues
        items={[
          ["Customer", `${c.name} · ${c.nipt}`],
          ["Billing address", `${c.street}, ${c.postalCode} ${c.city}`],
          ["Issued", formatDate(inv.issueDate)],
          ["Due", formatDate(inv.dueDate)],
          ["Exchange rate", <span key="r" className="tabular-nums">{formatRate(inv.currency, inv.exchangeRate)}</span>],
          [
            "Order",
            <a
              key="o"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                go.order(inv.orderId);
              }}
            >
              {inv.orderId}
            </a>,
          ],
        ]}
      />

      <ItemsTable order={order} products={products} />
      <FinancialSummary totals={inv} currency={inv.currency} rate={inv.exchangeRate} />

      <div className="flex flex-col gap-[6px]">
        <h4 className="m-0 text-[16px]">Payment history</h4>
        {pays.length === 0 ? (
          <p className="text-muted m-0 text-[13px]">No payments recorded.</p>
        ) : (
          <table className="table text-[13px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.method}</td>
                  <td>{p.reference}</td>
                  <td className="num">{formatMoney(p.amount, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}
