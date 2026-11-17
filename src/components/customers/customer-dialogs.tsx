"use client";

import { useState } from "react";
import { ADDRESS_TYPE_LABEL, option } from "@/lib/labels";
import { fieldErrors } from "@/lib/schemas/common";
import { addressSchema, contactSchema } from "@/lib/schemas/customers";
import { apiFetch, ApiError, errorMessage } from "@/services/client/http";
import type { AddressDto, ContactDto } from "@/services/client/types";
import { useActions } from "@/store/preview-store";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, SelectOptions } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { AlertBanner } from "@/components/ui/states";

const GRID = "grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]";

function useSave(onClose: () => void, onSaved: () => void) {
  const actions = useActions();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (path: string, method: "POST" | "PATCH", body: unknown, done: string) => {
    setSaving(true);
    setFormError("");
    try {
      await apiFetch(path, { method, body });
      onSaved();
      actions.toast(done);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.fieldMessages());
      else setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return { errors, setErrors, formError, saving, save };
}

/** Add or edit a customer contact (POST/PATCH /api/customers/:id/contacts). */
export function ContactDialog({ customerId, contact, onClose, onSaved }: { customerId: string; contact: ContactDto | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ fullName: contact?.fullName ?? "", jobTitle: contact?.jobTitle ?? "", phone: contact?.phone ?? "", email: contact?.email ?? "", isPrimary: contact?.isPrimary ?? false });
  const s = useSave(onClose, onSaved);
  const text = (k: "fullName" | "jobTitle" | "phone" | "email", id: string, label: string, type = "text") => (
    <Field label={label} htmlFor={id} error={s.errors[k]}>
      <input id={id} type={type} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...invalidProps(id, s.errors[k])} />
    </Field>
  );
  const submit = () => {
    const parsed = contactSchema.safeParse(f);
    if (!parsed.success) return s.setErrors(fieldErrors(parsed.error));
    const path = contact ? `/api/customers/${customerId}/contacts/${contact.id}` : `/api/customers/${customerId}/contacts`;
    // An existing primary stays primary; making another contact primary is a separate action.
    const body = contact?.isPrimary ? { ...f, isPrimary: true } : f;
    void s.save(path, contact ? "PATCH" : "POST", body, contact ? "Contact updated." : "Contact added.");
  };
  return (
    <Dialog onClose={onClose} labelledBy="ct-t">
      <div id="ct-t" className="dialog-title">
        {contact ? `Edit ${contact.fullName}` : "Add contact"}
      </div>
      {s.formError ? <AlertBanner>{s.formError}</AlertBanner> : null}
      <div className={GRID}>
        {text("fullName", "ct-name", "Full name *")}
        {text("jobTitle", "ct-pos", "Position")}
        {text("phone", "ct-phone", "Phone", "tel")}
        {text("email", "ct-email", "Email", "email")}
      </div>
      {!contact?.isPrimary ? (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} />
          Primary contact
        </label>
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={s.saving} onClick={submit}>
          {s.saving ? "Saving…" : "Save contact"}
        </Button>
      </div>
    </Dialog>
  );
}

/** Add or edit a customer address. Orders keep a snapshot, so edits never change past deliveries. */
export function AddressDialog({ customerId, address, onClose, onSaved }: { customerId: string; address: AddressDto | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    type: address?.type ?? "DELIVERY",
    label: address?.label ?? "",
    street: address?.street ?? "",
    city: address?.city ?? "",
    municipality: address?.municipality ?? "",
    postalCode: address?.postalCode ?? "",
    isDefault: address?.isDefault ?? false,
  });
  const s = useSave(onClose, onSaved);
  const text = (k: "label" | "street" | "city" | "municipality" | "postalCode", id: string, label: string, extra = "") => (
    <Field label={label} htmlFor={id} error={s.errors[k]} className={extra}>
      <input id={id} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...invalidProps(id, s.errors[k])} />
    </Field>
  );
  const submit = () => {
    const parsed = addressSchema.safeParse(f);
    if (!parsed.success) return s.setErrors(fieldErrors(parsed.error));
    const path = address ? `/api/customers/${customerId}/addresses/${address.id}` : `/api/customers/${customerId}/addresses`;
    const body = address?.isDefault ? { ...f, isDefault: true } : f;
    void s.save(path, address ? "PATCH" : "POST", body, address ? "Address updated." : "Address added.");
  };
  return (
    <Dialog onClose={onClose} labelledBy="ad-t">
      <div id="ad-t" className="dialog-title">
        {address ? "Edit address" : "Add address"}
      </div>
      {s.formError ? <AlertBanner>{s.formError}</AlertBanner> : null}
      {address?.usedByOrders ? (
        <p className="text-muted m-0 text-[12px]">Used by {address.usedByOrders} orders. They keep the address as it was when delivered.</p>
      ) : null}
      <div className={GRID}>
        <Field label="Type" htmlFor="ad-type">
          <select id="ad-type" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as typeof f.type })}>
            <SelectOptions options={option(ADDRESS_TYPE_LABEL)} />
          </select>
        </Field>
        {text("label", "ad-label", "Label")}
        {text("street", "ad-street", "Street address *", "col-span-full")}
        {text("city", "ad-city", "City *")}
        {text("municipality", "ad-muni", "Municipality")}
        {text("postalCode", "ad-postal", "Postal code")}
      </div>
      {!address?.isDefault ? (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
          Default address
        </label>
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={s.saving} onClick={submit}>
          {s.saving ? "Saving…" : "Save address"}
        </Button>
      </div>
    </Dialog>
  );
}
