"use client";

import { useState, type ReactNode } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { apiFetch, errorMessage } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { InvoiceDetailDto } from "@/services/client/types";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Blueprint } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Drawer, KeyValues } from "@/components/ui/overlay";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";
import { DecimalSummary, SnapshotItemsTable } from "@/components/sales/document-parts";
import { useGo } from "@/components/layout/use-go";
import { InvoiceStatusBadges, refreshFinancials } from "./invoice-badges";
import { CancelInvoiceDialog, DueDateDialog } from "./invoice-dialogs";

function Figure({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <Blueprint className={`px-3 py-[10px] ${highlight ? "border-accent" : ""}`}>
      <div className="text-[11px] text-neutral-700">{label}</div>
      <div className="font-heading text-[19px] font-semibold tabular-nums">{value}</div>
    </Blueprint>
  );
}

const useInvoice = (id: string) => useApiQuery<{ invoice: InvoiceDetailDto }>(`/api/invoices/${encodeURIComponent(id)}`);

/** Invoice detail from GET /api/invoices/:id. Issued values are immutable; every action is re-checked by the server. */
export function InvoiceDrawer() {
  const id = usePreview((s) => s.invoiceDrawerId);
  const actions = useActions();
  if (!id) return null;
  return (
    <Drawer label="Invoice details" width={580} onClose={actions.closeInvoice} header={<InvoiceHeader id={id} />}>
      <InvoiceBody key={id} id={id} />
    </Drawer>
  );
}

function InvoiceHeader({ id }: { id: string }) {
  const inv = useInvoice(id).data?.invoice;
  if (!inv) return <h2 className="m-0 text-[26px]">Invoice</h2>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-[10px]">
        <h2 className="m-0 text-[26px]">{inv.invoiceNumber}</h2>
        <InvoiceStatusBadges paymentStatus={inv.paymentStatus} overdue={inv.overdue} />
      </div>
      <span className="flex items-center gap-[6px] text-[12px] text-neutral-700">
        <Icon name="lock" size={14} />
        {inv.status === "CANCELLED" ? "Cancelled invoices stay on record and can't be changed." : "Issued values are locked. Corrections require cancellation and a replacement."}
      </span>
    </div>
  );
}

function InvoiceBody({ id }: { id: string }) {
  const q = useInvoice(id);
  const actions = useActions();
  const role = useRole();
  const go = useGo();
  const [dialog, setDialog] = useState<"cancel" | "replace" | null>(null);

  if (q.loading) return <SkeletonRows />;
  if (!q.data) {
    return (
      <div className="flex flex-col gap-3">
        <AlertBanner>{q.error?.status === 404 ? "No accessible invoice has this ID. It may belong to another representative." : errorMessage(q.error)}</AlertBanner>
        {q.error?.status !== 404 ? (
          <Button className="self-start" onClick={q.refetch}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  const inv = q.data.invoice;
  const cur = inv.currencyCode;
  const m = (v: string) => `${formatDecimal(v, 2, 2)} ${cur}`;
  const done = (message: string) => {
    refreshFinancials({ customerId: inv.customer.id });
    q.refetch();
    actions.toast(message);
  };
  const link = (href: string, label: ReactNode, onClick: () => void) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {label}
    </a>
  );
  const anyAction = inv.actions.recordPayment || inv.actions.cancel || inv.actions.replace;
  // Attribution is audit information the server sends to managers and admins only.
  const showRecorder = role.canRegisterPayments;

  return (
    <>
      {inv.status === "CANCELLED" && inv.cancellation ? (
        <AlertBanner>
          Cancelled {inv.cancellation.at ? formatDate(inv.cancellation.at.slice(0, 10)) : ""}
          {inv.cancellation.by ? ` by ${inv.cancellation.by}` : ""}: {inv.cancellation.reason}
        </AlertBanner>
      ) : null}

      <div className="grid grid-cols-3 gap-[14px]">
        <Figure label={`Total (${cur})`} value={m(inv.totals.grandTotal)} />
        <Figure label="Paid" value={m(inv.paid)} />
        <Figure label="Outstanding" value={m(inv.outstanding)} highlight />
      </div>
      {inv.overdue ? (
        <p className="m-0 -mt-2 text-[12.5px] text-danger-800">
          Overdue by {inv.daysOverdue} {inv.daysOverdue === 1 ? "day" : "days"}
          {inv.paymentStatus === "PARTIALLY_PAID" ? " · partially paid" : ""}.
        </p>
      ) : null}

      {anyAction ? (
        <div className="flex flex-wrap gap-2">
          {inv.actions.recordPayment ? (
            <Button variant="primary" icon="plus" onClick={() => actions.openPayment(inv.id)}>
              Register payment
            </Button>
          ) : null}
          {inv.actions.replace ? (
            <Button variant="primary" icon="invoices" onClick={() => setDialog("replace")}>
              Issue replacement invoice
            </Button>
          ) : null}
          {inv.actions.cancel ? <Button onClick={() => setDialog("cancel")}>Cancel invoice</Button> : null}
        </div>
      ) : null}

      <KeyValues
        items={[
          ["Customer", link(ROUTES.customer(inv.customer.id), `${inv.customer.billedName} · ${inv.customer.billedNipt}`, () => go.customer(inv.customer.id))],
          [
            "Billing address",
            inv.customer.billingFromSnapshot ? (
              inv.customer.billingAddress
            ) : (
              <span key="b">
                {inv.customer.billingAddress} <span className="text-[12px] text-neutral-700">(customer&apos;s current address; not recorded on this older invoice)</span>
              </span>
            ),
          ],
          ["Issued", formatDate(inv.issueDate)],
          ["Due", formatDate(inv.dueDate)],
          [
            "Exchange rate",
            cur === "ALL" ? (
              <span key="r" className="text-muted">
                Not applicable
              </span>
            ) : (
              <span key="r" className="tabular-nums">
                1 {cur} = {inv.rateText} ALL <span className="text-[12px] text-neutral-700">(stored on the invoice)</span>
              </span>
            ),
          ],
          ["Order", link(ROUTES.orders, `${inv.order.orderNumber} · ${inv.order.salesRep}`, () => go.order(inv.order.id))],
          ...(inv.replaces ? [["Replaces", link(ROUTES.invoices, inv.replaces.invoiceNumber, () => go.invoice(inv.replaces!.id))] as [string, ReactNode]] : []),
          ...(inv.replacedBy ? [["Replaced by", link(ROUTES.invoices, inv.replacedBy.invoiceNumber, () => go.invoice(inv.replacedBy!.id))] as [string, ReactNode]] : []),
        ]}
      />

      <SnapshotItemsTable items={inv.items} />
      <DecimalSummary totals={inv.totals} currency={cur} rateText={inv.rateText} totalAll={inv.totalAll} />

      <div className="flex flex-col gap-[6px]">
        <h4 className="m-0 text-[16px]">Payment history</h4>
        {inv.payments.length === 0 ? (
          <p className="text-muted m-0 text-[13px]">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Balance after</th>
                  {showRecorder ? <th>Recorded by</th> : null}
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{formatDate(p.paymentDate)}</td>
                    <td>{PAYMENT_METHOD_LABEL[p.method]}</td>
                    <td>{p.reference ?? <span className="text-muted">—</span>}</td>
                    <td className="num whitespace-nowrap">{m(p.amount)}</td>
                    <td className="num whitespace-nowrap text-neutral-700">{formatDecimal(p.balanceAfter, 2, 2)}</td>
                    {showRecorder ? <td className="whitespace-nowrap">{p.recordedBy ?? <span className="text-muted">Not recorded</span>}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <span className="text-[11.5px] text-neutral-700">Payments can&apos;t be edited or deleted once recorded.</span>
      </div>

      {dialog === "cancel" ? (
        <CancelInvoiceDialog
          invoiceNumber={inv.invoiceNumber}
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            await apiFetch(`/api/invoices/${inv.id}/cancel`, { method: "POST", body: { reason } });
            setDialog(null);
            done(`${inv.invoiceNumber} cancelled.`);
          }}
        />
      ) : null}
      {dialog === "replace" ? (
        <DueDateDialog
          title={`Replace ${inv.invoiceNumber}`}
          intro={`A new invoice for order ${inv.order.orderNumber} is issued with a new number and linked to ${inv.invoiceNumber}.`}
          summary={<div className="text-[13px] tabular-nums">Total {m(inv.totals.grandTotal)} (unchanged)</div>}
          termsDays={inv.customer.paymentTermsDays}
          submitLabel="Issue replacement"
          onClose={() => setDialog(null)}
          onSubmit={async (dueDate) => {
            const res = await apiFetch<{ invoice: InvoiceDetailDto }>(`/api/invoices/${inv.id}/replacement`, { method: "POST", body: { dueDate } });
            setDialog(null);
            done(`Replacement ${res.invoice.invoiceNumber} issued.`);
            go.invoice(res.invoice.id);
          }}
        />
      ) : null}
    </>
  );
}
