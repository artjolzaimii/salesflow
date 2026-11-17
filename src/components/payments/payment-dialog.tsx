"use client";

import { useState } from "react";
import { amountError } from "@/lib/amount-input";
import { businessDate } from "@/lib/business-date";
import { formatDecimal } from "@/lib/decimal-format";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { apiFetch, ApiError, errorMessage, qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { InvoiceDetailDto, InvoicePage, InvoiceRow } from "@/services/client/types";
import { useActions, usePreview } from "@/store/preview-store";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, Segmented } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { SearchSelect } from "@/components/ui/search-select";
import { refreshFinancials } from "@/components/invoices/invoice-badges";

type Method = keyof typeof PAYMENT_METHOD_LABEL;
const METHODS: Method[] = ["BANK_TRANSFER", "CASH", "CARD", "OTHER"];

/** Mounted by the shell; renders the form only while the dialog is open. */
export function PaymentDialog() {
  const open = usePreview((s) => s.paymentDialog);
  if (!open) return null;
  return <PaymentDialogForm key={open.invoiceId || "new"} initialInvoiceId={open.invoiceId} />;
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * POST /api/payments. The amount is checked here against the outstanding balance
 * for immediate feedback; the server checks again under a lock and rejects any
 * overpayment. One idempotency key per submission: a retry after a lost
 * response returns the original payment instead of recording it twice.
 */
function PaymentDialogForm({ initialInvoiceId }: { initialInvoiceId: string }) {
  const actions = useActions();
  const today = businessDate();
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<Method>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const detail = useApiQuery<{ invoice: InvoiceDetailDto }>(invoiceId ? `/api/invoices/${encodeURIComponent(invoiceId)}` : null);
  const inv = detail.data?.invoice;
  const payable = inv && inv.status === "ISSUED" && Number(inv.outstanding) > 0;
  const cur = inv?.currencyCode ?? "";
  const amountMsg = fieldErrors.amount || (inv ? amountError(amount, inv.outstanding, cur) : "");
  const dateMsg = fieldErrors.paymentDate || (date > today ? "The payment date can't be in the future." : inv && date < inv.issueDate ? `The invoice was issued on ${formatDate(inv.issueDate)}.` : "");
  const refMsg = fieldErrors.reference || "";
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setFieldErrors({});
    setError("");
  };

  const save = async () => {
    if (!inv || !payable) return setError("Select an invoice with an open balance.");
    if (!amount.trim() || amountMsg || dateMsg) return;
    if (method !== "CASH" && !reference.trim()) return setFieldErrors({ reference: "Enter the bank or POS reference for non-cash payments." });
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ payment: { amount: string; currencyCode: string } }>("/api/payments", {
        method: "POST",
        body: { invoiceId: inv.id, amount: amount.trim(), currencyCode: inv.currencyCode, paymentDate: date, method, reference: reference.trim() || undefined, idempotencyKey: key },
      });
      refreshFinancials({ customerId: inv.customer.id });
      detail.refetch();
      actions.closePayment();
      actions.toast(`Payment of ${formatDecimal(res.payment.amount, 2, 2)} ${res.payment.currencyCode} recorded on ${inv.invoiceNumber}.`);
    } catch (e) {
      // The server answered, so nothing was recorded: the next attempt is a new submission.
      // Network failures keep the key, so retrying cannot record the payment twice.
      if (e instanceof ApiError) {
        setKey(newKey());
        setFieldErrors(e.fieldMessages());
        if (e.code === "OVERPAYMENT" || e.code === "INVOICE_NOT_PAYABLE") detail.refetch();
      }
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog onClose={busy ? () => {} : actions.closePayment} labelledBy="pd-t">
      <div id="pd-t" className="dialog-title">
        Register payment
      </div>
      <Field label="Invoice" htmlFor="pd-inv" error={inv && !payable ? (inv.status === "CANCELLED" ? "This invoice is cancelled." : "This invoice is fully paid.") : undefined}>
        <SearchSelect<InvoiceRow>
          id="pd-inv"
          ariaLabel="Invoice"
          placeholder="Search open invoices by number or customer…"
          selectedLabel={inv ? `${inv.invoiceNumber} · ${inv.customer.businessName}` : ""}
          url={(t) => "/api/invoices" + qs({ status: "OPEN", q: t, pageSize: 8, sort: "dueDate", dir: "asc" })}
          items={(d) => (d as InvoicePage).items}
          itemKey={(i) => i.id}
          render={(i) => (
            <span className="flex items-baseline justify-between gap-3">
              <span>
                <span className="font-medium">{i.invoiceNumber}</span> · {i.customer.businessName}
              </span>
              <span className="text-[12px] whitespace-nowrap text-neutral-700 tabular-nums">
                {formatDecimal(i.outstanding, 2, 2)} {i.currencyCode} open{i.overdue ? " · overdue" : ""}
              </span>
            </span>
          )}
          onPick={(i) => edit(setInvoiceId)(i.id)}
        />
      </Field>
      {invoiceId && detail.loading ? <div className="text-[13px] text-neutral-700">Loading invoice…</div> : null}
      {detail.error ? <div className="text-[13px] text-danger-800">{errorMessage(detail.error)}</div> : null}
      {inv ? (
        <div className="grid grid-cols-3 gap-[10px] border border-divider px-3 py-[10px] text-[13px]">
          <div>
            <div className="text-muted text-[11px]">Invoice total</div>
            <div className="tabular-nums">
              {formatDecimal(inv.totals.grandTotal, 2, 2)} {cur}
            </div>
          </div>
          <div>
            <div className="text-muted text-[11px]">Previously paid</div>
            <div className="tabular-nums">
              {formatDecimal(inv.paid, 2, 2)} {cur}
            </div>
          </div>
          <div>
            <div className="text-muted text-[11px]">Outstanding</div>
            <div className="font-semibold tabular-nums">
              {formatDecimal(inv.outstanding, 2, 2)} {cur}
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Field label={`Amount (${cur || "—"})`} htmlFor="pd-amt" error={amountMsg}>
          <div className="flex gap-[6px]">
            <input
              id="pd-amt"
              className="input text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => edit(setAmount)(e.target.value)}
              {...invalidProps("pd-amt", amountMsg)}
            />
            <Button disabled={!payable} className="whitespace-nowrap" onClick={() => inv && edit(setAmount)(inv.outstanding)}>
              Full
            </Button>
          </div>
        </Field>
        <Field label="Payment date" htmlFor="pd-date" error={dateMsg}>
          <input id="pd-date" className="input" type="date" max={today} value={date} onChange={(e) => edit(setDate)(e.target.value)} {...invalidProps("pd-date", dateMsg)} />
        </Field>
      </div>
      <Field label="Payment method">
        <Segmented name="pd-m" label="Payment method" options={METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} value={method} onChange={(v) => edit(setMethod)(v as Method)} />
      </Field>
      <Field label="Reference number" htmlFor="pd-ref" error={refMsg}>
        <input
          id="pd-ref"
          className="input"
          maxLength={120}
          placeholder={method === "CASH" ? "Optional for cash" : "Bank or POS reference (required)"}
          value={reference}
          onChange={(e) => edit(setReference)(e.target.value)}
          {...invalidProps("pd-ref", refMsg)}
        />
      </Field>
      <p className="m-0 text-[12px] text-neutral-700">
        Payments are recorded in the invoice currency and can&apos;t be edited or deleted afterwards. The server rejects amounts above the outstanding balance.
      </p>
      {error ? (
        <div role="alert" className="text-[13px] text-danger-800">
          {error}
        </div>
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={actions.closePayment} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={busy || !payable || !amount.trim() || !!amountMsg || !!dateMsg}>
          {busy ? "Recording…" : "Record payment"}
        </Button>
      </div>
    </Dialog>
  );
}
