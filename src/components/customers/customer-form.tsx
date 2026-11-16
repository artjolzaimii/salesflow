"use client";

import { useState, type InputHTMLAttributes } from "react";
import { CUSTOMER_OPTIONS, PREVIEW_REP_ID } from "@/mocks/fixtures";
import type { AddressType, BusinessSize, BusinessType } from "@/lib/types";
import { BLANK_CUSTOMER_FORM, validateCustomer, type CustomerForm as Form, type FieldErrors } from "@/lib/validation";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Panel } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, Segmented, SelectOptions } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { AlertBanner } from "@/components/ui/states";
import { useGo } from "@/components/layout/use-go";
import { ROUTES } from "@/lib/navigation";

const GRID = "grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]";

/** Customer registration (POST /api/customers in production; NIPT re-validated server-side). */
export function CustomerForm() {
  const customers = usePreview((s) => s.data.customers);
  const employees = usePreview((s) => s.data.employees);
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const [f, setF] = useState<Form>(BLANK_CUSTOMER_FORM);
  const [errors, setErrors] = useState<FieldErrors<keyof Form>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const text = (k: keyof Form, id: string, extra?: InputHTMLAttributes<HTMLInputElement>) => (
    <input id={id} className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} {...invalidProps(id, errors[k])} {...extra} />
  );

  const save = () => {
    // Representatives always register customers to themselves.
    const form = role.scopedToOwnCustomers ? { ...f, repId: f.repId || PREVIEW_REP_ID } : f;
    const e = validateCustomer(form, customers);
    if (Object.keys(e).length) return setErrors(e);
    const customer = actions.createCustomer({
      name: form.name.trim(),
      nipt: form.nipt.trim().toUpperCase(),
      city: form.city,
      type: form.type as BusinessType,
      size: form.size as BusinessSize,
      repId: form.repId,
      active: form.status === "active",
      contactName: form.contact.trim(),
      contactPosition: form.position,
      phone: form.phone.trim(),
      email: form.email.trim(),
      street: form.street.trim(),
      postalCode: form.postal,
      municipality: form.municipality || form.city,
      addressType: form.addressType as AddressType,
      notes: form.notes,
    });
    setF(BLANK_CUSTOMER_FORM);
    setErrors({});
    go.customer(customer.id);
  };

  const cancel = () => {
    setF(BLANK_CUSTOMER_FORM);
    setErrors({});
    go.to(ROUTES.customers);
  };

  const errorCount = Object.keys(errors).length;

  return (
    <>
      <PageHeader
        title="Register customer"
        subtitle="Fields marked * are required. NIPT is validated again by the server."
        actions={
          <>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save customer
            </Button>
          </>
        }
      />
      {errorCount ? <AlertBanner>{errorCount} fields need attention</AlertBanner> : null}
      <div className="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]">
        <Panel className="gap-[14px]">
          <h3 className="panel-title">Business information</h3>
          <div className={GRID}>
            <Field label="Business name *" htmlFor="cf-name" error={errors.name} className="col-span-full">
              {text("name", "cf-name")}
            </Field>
            <Field label="NIPT / NUIS *" htmlFor="cf-nipt" error={errors.nipt}>
              {text("nipt", "cf-nipt", { placeholder: "L12345678A", className: "input uppercase tabular-nums" })}
            </Field>
            <Field label="Status">
              <Segmented
                name="cf-st"
                label="Status"
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
                value={f.status}
                onChange={(v) => set("status", v as Form["status"])}
              />
            </Field>
            <Field label="Business type *" htmlFor="cf-type" error={errors.type}>
              <select id="cf-type" className="input" value={f.type} onChange={(e) => set("type", e.target.value)} {...invalidProps("cf-type", errors.type)}>
                <option value="">Select…</option>
                <SelectOptions options={CUSTOMER_OPTIONS.types} />
              </select>
            </Field>
            <Field label="Business size *" htmlFor="cf-size" error={errors.size}>
              <select id="cf-size" className="input" value={f.size} onChange={(e) => set("size", e.target.value)} {...invalidProps("cf-size", errors.size)}>
                <option value="">Select…</option>
                <SelectOptions options={CUSTOMER_OPTIONS.sizes} />
              </select>
            </Field>
          </div>
        </Panel>

        <Panel className="gap-[14px]">
          <h3 className="panel-title">Contact information</h3>
          <div className={GRID}>
            <Field label="Contact name *" htmlFor="cf-contact" error={errors.contact}>
              {text("contact", "cf-contact")}
            </Field>
            <Field label="Position" htmlFor="cf-pos">
              {text("position", "cf-pos")}
            </Field>
            <Field label="Phone *" htmlFor="cf-phone" error={errors.phone}>
              {text("phone", "cf-phone", { type: "tel", placeholder: "+355 69 123 4567" })}
            </Field>
            <Field label="Email" htmlFor="cf-email" error={errors.email}>
              {text("email", "cf-email", { type: "email" })}
            </Field>
          </div>
        </Panel>

        <Panel className="gap-[14px]">
          <h3 className="panel-title">Address</h3>
          <div className={GRID}>
            <Field label="City *" htmlFor="cf-city" error={errors.city}>
              <select id="cf-city" className="input" value={f.city} onChange={(e) => set("city", e.target.value)} {...invalidProps("cf-city", errors.city)}>
                <option value="">Select…</option>
                <SelectOptions options={CUSTOMER_OPTIONS.cities} />
              </select>
            </Field>
            <Field label="Municipality" htmlFor="cf-muni">
              {text("municipality", "cf-muni")}
            </Field>
            <Field label="Street address *" htmlFor="cf-street" error={errors.street} className="col-span-full">
              {text("street", "cf-street")}
            </Field>
            <Field label="Postal code" htmlFor="cf-postal" error={errors.postal}>
              {text("postal", "cf-postal", { inputMode: "numeric", placeholder: "1001" })}
            </Field>
            <Field label="Address type" htmlFor="cf-at">
              <select id="cf-at" className="input" value={f.addressType} onChange={(e) => set("addressType", e.target.value)}>
                <SelectOptions options={[...CUSTOMER_OPTIONS.addressTypes]} />
              </select>
            </Field>
          </div>
        </Panel>

        <Panel className="gap-[14px]">
          <h3 className="panel-title">Commercial</h3>
          <Field label="Assigned sales representative *" htmlFor="cf-rep" error={errors.repId}>
            {role.scopedToOwnCustomers ? (
              <input id="cf-rep" className="input" value={`${role.user} (you)`} disabled />
            ) : (
              <select id="cf-rep" className="input" value={f.repId} onChange={(e) => set("repId", e.target.value)} {...invalidProps("cf-rep", errors.repId)}>
                <option value="">Select…</option>
                <SelectOptions options={employees.map((e) => ({ value: e.id, label: e.name }))} />
              </select>
            )}
          </Field>
          <Field label="Customer notes" htmlFor="cf-notes">
            <textarea
              id="cf-notes"
              className="input"
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Delivery windows, receiving contact, payment habits"
            />
          </Field>
        </Panel>
      </div>
    </>
  );
}
