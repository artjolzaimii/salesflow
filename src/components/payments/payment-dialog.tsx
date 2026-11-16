"use client";

import { useState } from "react";
import { formatMoney, inputToCents } from "@/lib/money";
import type { PaymentMethod } from "@/lib/types";
import { paymentAmountError, validatePayment, type PaymentForm } from "@/lib/validation";
import { useActions, usePreview } from "@/store/preview-store";
import { useScopedData } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Field, Segmented } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";

const METHODS: PaymentMethod[] = ["Bank transfer", "Cash", "Card"];

/** Mounted by the shell; renders the form only while the dialog is open. */
export function PaymentDialog() {
  const open = usePreview((s) => s.paymentDialog);
  if (!open) return null;
  return <PaymentDialogForm key={open.invoiceId || "new"} initialInvoiceId={open.invoiceId} />;
}

function PaymentDialogForm({ initialInvoiceId }: { initialInvoiceId: string }) {
  const today = usePreview((s) => s.today);
  const { invoices, customerById } = useScopedData();
  const actions = useActions();
  const [f, setF] = useState<PaymentForm>({ invoiceId: initialInvoiceId, amount: "", date: today, method: "Bank transfer", reference: "" });
  const [error, setError] = useState("");
  const set = <K extends keyof PaymentForm>(k: K, v: PaymentForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const inv = invoices.find((i) => i.id === f.invoiceId);
  const amountError = paymentAmountError(f, inv);
  const open = invoices.filter((i) => i.outstanding > 0);

  const save = () => {
    const err = validatePayment(f, inv);
    if (err || !inv) return setError(err ?? "Select an invoice.");
    actions.recordPayment({ invoiceId: inv.id, amount: inputToCents(f.amount), date: f.date, method: f.method, reference: f.reference });
  };

  return (
    <Dialog onClose={actions.closePayment} labelledBy="pd-t">
      <div id="pd-t" className="dialog-title">
        Register payment
      </div>
      <Field label="Invoice" htmlFor="pd-inv">
        <select id="pd-inv" className="input" value={f.invoiceId} onChange={(e) => set("invoiceId", e.target.value)}>
          <option value="">Select an invoice with an open balance…</option>
          {open.map((i) => (
            <option key={i.id} value={i.id}>
              {i.id} · {customerById[i.customerId].name} · {formatMoney(i.outstanding, i.currency)} open
            </option>
          ))}
        </select>
      </Field>
      {inv ? (
        <div className="grid grid-cols-3 gap-[10px] border border-divider px-3 py-[10px] text-[13px]">
          <div>
            <div className="text-muted text-[11px]">Invoice total</div>
            <div className="tabular-nums">{formatMoney(inv.total, inv.currency)}</div>
          </div>
          <div>
            <div className="text-muted text-[11px]">Previously paid</div>
            <div className="tabular-nums">{formatMoney(inv.paid, inv.currency)}</div>
          </div>
          <div>
            <div className="text-muted text-[11px]">Outstanding</div>
            <div className="font-semibold tabular-nums">{formatMoney(inv.outstanding, inv.currency)}</div>
          </div>
        </div>
      ) : null}
      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Field label={`Amount (${inv ? inv.currency : "—"})`} htmlFor="pd-amt" error={amountError}>
          <div className="flex gap-[6px]">
            <input
              id="pd-amt"
              className="input text-right tabular-nums"
              inputMode="decimal"
              value={f.amount}
              aria-invalid={amountError ? true : undefined}
              onChange={(e) => set("amount", e.target.value)}
            />
            <Button disabled={!inv} className="whitespace-nowrap" onClick={() => inv && set("amount", (inv.outstanding / 100).toFixed(2))}>
              Full
            </Button>
          </div>
        </Field>
        <Field label="Payment date" htmlFor="pd-date">
          <input id="pd-date" className="input" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
      </div>
      <Field label="Payment method">
        <Segmented name="pd-m" label="Payment method" options={METHODS.map((m) => ({ value: m, label: m }))} value={f.method} onChange={(v) => set("method", v as PaymentMethod)} />
      </Field>
      <Field label="Reference number" htmlFor="pd-ref">
        <input id="pd-ref" className="input" placeholder="Bank or POS reference; optional for cash" value={f.reference} onChange={(e) => set("reference", e.target.value)} />
      </Field>
      <p className="m-0 text-[12px] text-neutral-700">Payments are recorded in the invoice currency. The server rejects amounts above the outstanding balance.</p>
      {error ? (
        <div role="alert" className="text-[13px] text-danger-800">
          {error}
        </div>
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={actions.closePayment}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!!amountError || !inv}>
          Record payment
        </Button>
      </div>
    </Dialog>
  );
}
