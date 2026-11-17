"use client";

import { useState, type ReactNode } from "react";
import { businessDate } from "@/lib/business-date";
import { DEFAULT_DUE_DAYS, MAX_DUE_DAYS } from "@/lib/invoice-status";
import { addDays, formatDate } from "@/lib/money";
import { ApiError, errorMessage } from "@/services/client/http";
import { Button } from "@/components/ui/button";
import { Field, invalidProps } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";

/**
 * Issue or replacement invoice: the issue date is today (set by the server) and
 * the user picks the due date. Amounts are copied from the order on the server;
 * nothing here is sent except the due date.
 */
export function DueDateDialog({
  title,
  intro,
  summary,
  termsDays,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  intro: ReactNode;
  summary: ReactNode;
  termsDays: number | null;
  submitLabel: string;
  onSubmit: (dueDate: string) => Promise<void>;
  onClose: () => void;
}) {
  const today = businessDate();
  const [due, setDue] = useState(addDays(today, termsDays ?? DEFAULT_DUE_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const latest = addDays(today, MAX_DUE_DAYS);
  const localError = !due ? "Choose a due date." : due < today ? "The due date can't be before today." : due > latest ? "Choose a due date within one year." : "";
  const shownFieldError = localError || fieldError;

  const submit = async () => {
    if (localError) return;
    setBusy(true);
    setError("");
    setFieldError("");
    try {
      await onSubmit(due);
    } catch (e) {
      const fields = e instanceof ApiError ? e.fieldMessages() : {};
      if (fields.dueDate) setFieldError(fields.dueDate);
      else setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog onClose={busy ? () => {} : onClose} labelledBy="dd-t" width={480} zIndex={85}>
      <div id="dd-t" className="dialog-title">
        {title}
      </div>
      <div className="dialog-body flex flex-col gap-3">
        <div>{intro}</div>
        {summary}
        <div className="grid grid-cols-2 gap-[14px]">
          <Field label="Issue date">
            <div className="input bg-transparent text-neutral-700">{formatDate(today)}</div>
          </Field>
          <Field label="Due date" htmlFor="dd-due" error={shownFieldError} hint={termsDays ? `Customer terms: ${termsDays} days` : `Default: ${DEFAULT_DUE_DAYS} days`}>
            <input id="dd-due" className="input" type="date" min={today} max={latest} value={due} onChange={(e) => setDue(e.target.value)} {...invalidProps("dd-due", shownFieldError)} />
          </Field>
        </div>
        <p className="m-0 text-[12px] text-neutral-700">
          The invoice copies the order&apos;s amounts, VAT, currency and exchange rate as they are stored. It gets the next internal SalesFlow invoice number; this
          is not a fiscalized number.
        </p>
        {error ? (
          <div role="alert" className="text-[13px] text-danger-800">
            {error}
          </div>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Go back
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy || !!localError}>
          {busy ? "Issuing…" : submitLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/** Cancellation needs a reason; the invoice and its number stay on record. */
export function CancelInvoiceDialog({ invoiceNumber, onSubmit, onClose }: { invoiceNumber: string; onSubmit: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const fieldError = touched && trimmed.length < 3 ? "Give a reason of at least 3 characters." : trimmed.length > 500 ? "Keep the reason under 500 characters." : "";

  const submit = async () => {
    setTouched(true);
    if (trimmed.length < 3 || trimmed.length > 500) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog onClose={busy ? () => {} : onClose} role="alertdialog" labelledBy="ci-t" width={460} zIndex={85}>
      <div id="ci-t" className="dialog-title">
        Cancel {invoiceNumber}?
      </div>
      <div className="dialog-body flex flex-col gap-3">
        <div>
          The invoice stays on record with its number, marked Cancelled, together with your reason, name and the time. It can&apos;t be reissued; a replacement
          invoice with a new number can be issued afterwards.
        </div>
        <Field label="Reason for cancellation" htmlFor="ci-reason" error={fieldError}>
          <textarea
            id="ci-reason"
            className="input min-h-[84px]"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            {...invalidProps("ci-reason", fieldError)}
          />
        </Field>
        {error ? (
          <div role="alert" className="text-[13px] text-danger-800">
            {error}
          </div>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Go back
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel invoice"}
        </Button>
      </div>
    </Dialog>
  );
}
