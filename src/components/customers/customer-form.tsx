"use client";

import { useState, type InputHTMLAttributes } from "react";
import { ADDRESS_TYPE_LABEL, BUSINESS_SIZE_LABEL, BUSINESS_TYPE_LABEL, CITIES, CUSTOMER_STATUS_LABEL, option, type CustomerStatusCode } from "@/lib/labels";
import { ROUTES } from "@/lib/navigation";
import { fieldErrors } from "@/lib/schemas/common";
import { customerCreateSchema, customerPatchSchema } from "@/lib/schemas/customers";
import { apiFetch, ApiError, errorMessage } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { CustomerDetailDto, EmployeePage } from "@/services/client/types";
import { useActions } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Panel } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, Segmented, SelectOptions } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";
import { useGo } from "@/components/layout/use-go";

const GRID = "grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]";

interface Form {
  name: string;
  nipt: string;
  type: string;
  size: string;
  status: CustomerStatusCode;
  contact: string;
  position: string;
  phone: string;
  email: string;
  city: string;
  municipality: string;
  street: string;
  postal: string;
  addressType: string;
  repId: string;
  notes: string;
}

const BLANK: Form = {
  name: "",
  nipt: "",
  type: "",
  size: "",
  status: "ACTIVE",
  contact: "",
  position: "",
  phone: "",
  email: "",
  city: "",
  municipality: "",
  street: "",
  postal: "",
  addressType: "DELIVERY",
  repId: "",
  notes: "",
};

/** API field paths (create and patch) → form fields. */
const API_TO_FORM: Record<string, keyof Form> = {
  businessName: "name",
  nipt: "nipt",
  businessType: "type",
  businessSize: "size",
  status: "status",
  city: "city",
  municipality: "municipality",
  email: "email",
  phone: "phone",
  notes: "notes",
  assignedRepId: "repId",
  contacts: "contact",
  "contacts.0.fullName": "contact",
  "contacts.0.jobTitle": "position",
  "contacts.0.phone": "phone",
  "contacts.0.email": "email",
  addresses: "street",
  "addresses.0.street": "street",
  "addresses.0.city": "city",
  "addresses.0.municipality": "municipality",
  "addresses.0.postalCode": "postal",
};

function toFormErrors(errors: Record<string, string>): Partial<Record<keyof Form, string>> {
  const out: Partial<Record<keyof Form, string>> = {};
  for (const [k, v] of Object.entries(errors)) {
    const f = API_TO_FORM[k];
    if (f && !out[f]) out[f] = v;
  }
  return out;
}

/** Register (POST /api/customers) or edit (PATCH /api/customers/:id) a customer. */
export function CustomerForm({ customerId }: { customerId?: string }) {
  const existing = useApiQuery<{ customer: CustomerDetailDto }>(customerId ? `/api/customers/${customerId}` : null);
  if (!customerId) return <CustomerFormInner initial={BLANK} />;
  if (!existing.data) return existing.error ? <AlertBanner>{errorMessage(existing.error)}</AlertBanner> : <SkeletonRows />;
  const c = existing.data.customer;
  return (
    <CustomerFormInner
      key={c.id}
      customer={c}
      initial={{
        ...BLANK,
        name: c.businessName,
        nipt: c.nipt,
        type: c.businessType,
        size: c.businessSize ?? "",
        status: c.status,
        phone: c.phone ?? "",
        email: c.email ?? "",
        city: c.city,
        municipality: c.municipality ?? "",
        repId: c.assignedRep?.id ?? "",
        notes: c.notes ?? "",
      }}
    />
  );
}

function CustomerFormInner({ initial, customer }: { initial: Form; customer?: CustomerDetailDto }) {
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const editing = !!customer;
  const reps = useApiQuery<EmployeePage>(role.canAssignCustomers ? "/api/employees?active=true&pageSize=100&sort=lastName" : null);
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const text = (k: keyof Form, id: string, extra?: InputHTMLAttributes<HTMLInputElement>) => (
    <input id={id} className="input" value={f[k]} onChange={(e) => set(k, e.target.value as Form[typeof k])} {...invalidProps(id, errors[k])} {...extra} />
  );

  const cities = f.city && !(CITIES as readonly string[]).includes(f.city) ? [f.city, ...CITIES] : [...CITIES];
  const statusOptions = option(CUSTOMER_STATUS_LABEL).filter((o) => o.value !== "BLOCKED" || role.canAssignCustomers || initial.status === "BLOCKED");

  const save = async () => {
    const business = {
      businessName: f.name,
      nipt: f.nipt,
      businessType: f.type || undefined,
      businessSize: f.size || null,
      status: f.status,
      city: f.city,
      municipality: f.municipality,
      email: f.email,
      phone: f.phone,
      notes: f.notes,
      ...(role.canAssignCustomers ? { assignedRepId: f.repId || null } : {}),
    };
    const body = editing
      ? business
      : {
          ...business,
          contacts: [{ fullName: f.contact, jobTitle: f.position, phone: f.phone, email: f.email, isPrimary: true }],
          addresses: [{ type: f.addressType, street: f.street, city: f.city, municipality: f.municipality, postalCode: f.postal, isDefault: true }],
        };

    // Same schema as the server, plus the fields this screen makes mandatory.
    const parsed = (editing ? customerPatchSchema : customerCreateSchema).safeParse(body);
    const errs = parsed.success ? {} : toFormErrors(fieldErrors(parsed.error));
    if (!f.size) errs.size ??= "Select a business size.";
    if (!editing && !f.phone.trim()) errs.phone ??= "Phone is required.";
    if (role.canAssignCustomers && !f.repId) errs.repId ??= "Assign a sales representative.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setFormError("");
    try {
      const res = await apiFetch<{ customer: { id: string; businessName: string } }>(editing ? `/api/customers/${customer.id}` : "/api/customers", {
        method: editing ? "PATCH" : "POST",
        body,
      });
      invalidate("/api/customers");
      invalidate("/api/employees");
      actions.toast(editing ? `${res.customer.businessName} updated.` : `${res.customer.businessName} registered.`);
      go.customer(res.customer.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_NIPT") setErrors({ nipt: e.message });
      else if (e instanceof ApiError && e.details) setErrors(toFormErrors(e.fieldMessages()));
      else setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => go.to(editing ? `/customers/${customer.id}` : ROUTES.customers);
  const errorCount = Object.keys(errors).length;

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${customer.businessName}` : "Register customer"}
        subtitle="Fields marked * are required. NIPT is validated again by the server."
        actions={
          <>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save customer"}
            </Button>
          </>
        }
      />
      {errorCount ? <AlertBanner>{errorCount} fields need attention</AlertBanner> : null}
      {formError ? <AlertBanner>{formError}</AlertBanner> : null}
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
              <Segmented name="cf-st" label="Status" options={statusOptions} value={f.status} onChange={(v) => set("status", v as CustomerStatusCode)} />
            </Field>
            <Field label="Business type *" htmlFor="cf-type" error={errors.type}>
              <select id="cf-type" className="input" value={f.type} onChange={(e) => set("type", e.target.value)} {...invalidProps("cf-type", errors.type)}>
                <option value="">Select…</option>
                <SelectOptions options={option(BUSINESS_TYPE_LABEL)} />
              </select>
            </Field>
            <Field label="Business size *" htmlFor="cf-size" error={errors.size}>
              <select id="cf-size" className="input" value={f.size} onChange={(e) => set("size", e.target.value)} {...invalidProps("cf-size", errors.size)}>
                <option value="">Select…</option>
                <SelectOptions options={option(BUSINESS_SIZE_LABEL)} />
              </select>
            </Field>
          </div>
        </Panel>

        <Panel className="gap-[14px]">
          <h3 className="panel-title">{editing ? "Business contact details" : "Contact information"}</h3>
          <div className={GRID}>
            {!editing ? (
              <>
                <Field label="Contact name *" htmlFor="cf-contact" error={errors.contact}>
                  {text("contact", "cf-contact")}
                </Field>
                <Field label="Position" htmlFor="cf-pos" error={errors.position}>
                  {text("position", "cf-pos")}
                </Field>
              </>
            ) : null}
            <Field label={editing ? "Phone" : "Phone *"} htmlFor="cf-phone" error={errors.phone}>
              {text("phone", "cf-phone", { type: "tel", placeholder: "+355 69 123 4567" })}
            </Field>
            <Field label="Email" htmlFor="cf-email" error={errors.email}>
              {text("email", "cf-email", { type: "email" })}
            </Field>
          </div>
          {editing ? <p className="text-muted m-0 text-[12px]">Contact people are managed on the customer&apos;s Contacts tab.</p> : null}
        </Panel>

        <Panel className="gap-[14px]">
          <h3 className="panel-title">{editing ? "Location" : "Address"}</h3>
          <div className={GRID}>
            <Field label="City *" htmlFor="cf-city" error={errors.city}>
              <select id="cf-city" className="input" value={f.city} onChange={(e) => set("city", e.target.value)} {...invalidProps("cf-city", errors.city)}>
                <option value="">Select…</option>
                <SelectOptions options={cities} />
              </select>
            </Field>
            <Field label="Municipality" htmlFor="cf-muni" error={errors.municipality}>
              {text("municipality", "cf-muni")}
            </Field>
            {!editing ? (
              <>
                <Field label="Street address *" htmlFor="cf-street" error={errors.street} className="col-span-full">
                  {text("street", "cf-street")}
                </Field>
                <Field label="Postal code" htmlFor="cf-postal" error={errors.postal}>
                  {text("postal", "cf-postal", { inputMode: "numeric", placeholder: "1001" })}
                </Field>
                <Field label="Address type" htmlFor="cf-at">
                  <select id="cf-at" className="input" value={f.addressType} onChange={(e) => set("addressType", e.target.value)}>
                    <SelectOptions options={option(ADDRESS_TYPE_LABEL)} />
                  </select>
                </Field>
              </>
            ) : null}
          </div>
          {editing ? <p className="text-muted m-0 text-[12px]">Delivery and billing addresses are managed on the customer&apos;s Addresses tab.</p> : null}
        </Panel>

        <Panel className="gap-[14px]">
          <h3 className="panel-title">Commercial</h3>
          <Field label="Assigned sales representative *" htmlFor="cf-rep" error={errors.repId}>
            {role.canAssignCustomers ? (
              <select id="cf-rep" className="input" value={f.repId} onChange={(e) => set("repId", e.target.value)} {...invalidProps("cf-rep", errors.repId)}>
                <option value="">Select…</option>
                <SelectOptions options={(reps.data?.items ?? []).map((e) => ({ value: e.id, label: e.name }))} />
              </select>
            ) : (
              <input id="cf-rep" className="input" value={customer?.assignedRep ? customer.assignedRep.name : `${role.user} (you)`} disabled />
            )}
          </Field>
          <Field label="Customer notes" htmlFor="cf-notes" error={errors.notes}>
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
