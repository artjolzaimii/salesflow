"use client";

import { useState } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { CUSTOMER_STATUS_LABEL } from "@/lib/labels";
import { ROLE_TITLES, USER_ROLES } from "@/lib/permissions";
import { fieldErrors } from "@/lib/schemas/common";
import { employeeCreateSchema } from "@/lib/schemas/employees";
import { apiFetch, ApiError, errorMessage, qs } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { EmployeeDetailDto, EmployeePage } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { useActions } from "@/store/preview-store";
import { apiListState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, SelectOptions } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { Dialog, Drawer, KeyValues } from "@/components/ui/overlay";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { AlertBanner, EmptyLine, SkeletonRows } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";

const PAGE_SIZE = 25;
const MONTH = new Date().toLocaleString("en-GB", { month: "short" });

/** Employees from GET /api/employees (managers and admins). */
export function EmployeesView() {
  const role = useRole();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q.trim());

  const list = useApiQuery<EmployeePage>(
    "/api/employees" + qs({ q: dq, active: status === "all" ? undefined : status === "active", page: page + 1, pageSize: PAGE_SIZE, sort: "lastName" }),
  );
  const state = apiListState(list, list.data?.items ?? [], "employees", !!dq || status !== "all");

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={`Sales team, their territories and assigned customers. ${MONTH} figures are month to date.`}
        actions={
          role.canManageEmployees ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New employee
            </Button>
          ) : null
        }
      />
      <ListPanel
        state={state}
        onClear={() => {
          setQ("");
          setStatus("all");
          setPage(0);
        }}
        filters={
          <FilterRow>
            <input
              className="input w-[240px] max-w-full"
              type="search"
              aria-label="Search employees"
              placeholder="Name, email or territory"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
            <select
              className="input w-auto"
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">Active and inactive</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Territory</th>
                <th className="text-right">Customers</th>
                <th className="text-right">Orders ({MONTH})</th>
                <th className="text-right">Net invoiced, ALL ({MONTH})</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.user ? ROLE_TITLES[r.user.role] : <span className="text-muted">No login</span>}</td>
                  <td>{r.territory ?? "—"}</td>
                  <td className="text-right">{r.customerCount}</td>
                  <td className="text-right">{r.ordersThisMonth}</td>
                  <td className="num">{formatDecimal(r.netInvoicedAllThisMonth, 0, 0)}</td>
                  <td>
                    <StatusBadge label={r.isActive ? "Active" : "Inactive"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} size={PAGE_SIZE} onPage={setPage} />
      </ListPanel>
      {openId ? <EmployeeDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
      {creating ? <EmployeeDialog onClose={() => setCreating(false)} onCreated={(id) => setOpenId(id)} /> : null}
    </>
  );
}

function EmployeeDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const detail = useApiQuery<{ employee: EmployeeDetailDto }>(`/api/employees/${id}`);
  const others = useApiQuery<EmployeePage>(role.canAssignCustomers ? "/api/employees?active=true&pageSize=100&sort=lastName" : null);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const e = detail.data?.employee;

  const refresh = () => {
    invalidate("/api/employees");
    invalidate("/api/customers");
  };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      refresh();
      actions.toast(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const targets = (others.data?.items ?? []).filter((x) => x.id !== id);
  const hasCustomers = !!e?.assignedCustomers.length;

  return (
    <Drawer
      label="Employee details"
      width={560}
      onClose={onClose}
      header={
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-[10px]">
            <h2 className="m-0 text-[26px]">{e?.name ?? "Employee"}</h2>
            {e ? <StatusBadge label={e.isActive ? "Active" : "Inactive"} /> : null}
          </div>
          {e ? <span className="text-[13px] text-neutral-700">{e.user ? `${ROLE_TITLES[e.user.role]} · ${e.user.email}` : "No login account"}</span> : null}
        </div>
      }
    >
      {!e ? (
        detail.error ? <AlertBanner>{errorMessage(detail.error)}</AlertBanner> : <SkeletonRows />
      ) : editing ? (
        <EmployeeEditForm employee={e} onDone={() => setEditing(false)} />
      ) : (
        <>
          {error ? <AlertBanner>{error}</AlertBanner> : null}
          {role.canManageEmployees ? (
            <div className="flex flex-wrap gap-2">
              <Button icon="edit" onClick={() => setEditing(true)}>
                Edit
              </Button>
              {e.isActive ? (
                <Button
                  disabled={busy || (hasCustomers && !target)}
                  title={hasCustomers && !target ? "Choose who takes over the customers below" : undefined}
                  onClick={() =>
                    run(() => apiFetch(`/api/employees/${id}`, { method: "PATCH", body: { isActive: false, ...(hasCustomers ? { reassignCustomersTo: target } : {}) } }), `${e.name} deactivated.`)
                  }
                >
                  Deactivate
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => run(() => apiFetch(`/api/employees/${id}`, { method: "PATCH", body: { isActive: true } }), `${e.name} reactivated.`)}>
                  Reactivate
                </Button>
              )}
            </div>
          ) : null}
          <KeyValues
            items={[
              ["Phone", e.phone ?? "—"],
              ["Territory", e.territory ?? "—"],
              ["Orders on record", String(e.orderCount)],
              ["Sign-in", e.user ? (e.user.isActive && e.isActive ? "Allowed" : "Blocked") : "No account"],
            ]}
          />
          <div className="flex flex-col gap-2">
            <h4 className="m-0 text-[16px]">Assigned customers ({e.assignedCustomers.length})</h4>
            {hasCustomers ? (
              <table className="table text-[13px]">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>NIPT</th>
                    <th>City</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {e.assignedCustomers.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => go.customer(c.id)}>
                      <td className="font-medium">{c.businessName}</td>
                      <td className="tabular-nums">{c.nipt}</td>
                      <td>{c.city}</td>
                      <td>
                        <StatusBadge label={CUSTOMER_STATUS_LABEL[c.status]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyLine>No customers assigned.</EmptyLine>
            )}
            {hasCustomers && role.canAssignCustomers ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Move all customers to" htmlFor="emp-target" className="min-w-[220px] flex-1">
                  <select id="emp-target" className="input" value={target} onChange={(ev) => setTarget(ev.target.value)}>
                    <option value="">Select…</option>
                    <SelectOptions options={targets.map((t) => ({ value: t.id, label: t.name }))} />
                  </select>
                </Field>
                <Button
                  disabled={!target || busy}
                  onClick={() => run(() => apiFetch(`/api/employees/${id}/reassign`, { method: "POST", body: { toEmployeeId: target } }), "Customers reassigned.")}
                >
                  Reassign
                </Button>
              </div>
            ) : null}
            <span className="text-[11.5px] text-neutral-700">Reassigning changes who looks after the customer from now on. Past orders keep their original representative.</span>
          </div>
        </>
      )}
    </Drawer>
  );
}

function EmployeeEditForm({ employee, onDone }: { employee: EmployeeDetailDto; onDone: () => void }) {
  const actions = useActions();
  const [f, setF] = useState({ firstName: employee.firstName, lastName: employee.lastName, phone: employee.phone ?? "", territory: employee.territory ?? "" });
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    try {
      await apiFetch(`/api/employees/${employee.id}`, { method: "PATCH", body: f });
      invalidate("/api/employees");
      actions.toast("Employee updated.");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.fieldMessages());
      else setError(errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-[14px]">
      {error ? <AlertBanner>{error}</AlertBanner> : null}
      <PersonFields f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} errors={errors} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

type Person = { firstName: string; lastName: string; phone: string; territory: string };

function PersonFields({ f, set, errors }: { f: Person; set: (k: keyof Person, v: string) => void; errors: Record<string, string> }) {
  const input = (k: keyof Person, id: string, label: string) => (
    <Field label={label} htmlFor={id} error={errors[k]}>
      <input id={id} className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} {...invalidProps(id, errors[k])} />
    </Field>
  );
  return (
    <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
      {input("firstName", "emp-first", "First name")}
      {input("lastName", "emp-last", "Last name")}
      {input("phone", "emp-phone", "Phone")}
      {input("territory", "emp-terr", "Territory")}
    </div>
  );
}

/** New employee, with an optional login account (administrators only). */
function EmployeeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const role = useRole();
  const actions = useActions();
  const [f, setF] = useState<Person>({ firstName: "", lastName: "", phone: "", territory: "" });
  const [withLogin, setWithLogin] = useState(true);
  const [account, setAccount] = useState({ email: "", role: "SALES_REPRESENTATIVE", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const canLogin = role.canCreateLogins;

  const save = async () => {
    const body = { ...f, ...(canLogin && withLogin ? { account } : {}) };
    const parsed = employeeCreateSchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setSaving(true);
    try {
      const res = await apiFetch<{ employee: { id: string; name: string } }>("/api/employees", { method: "POST", body });
      invalidate("/api/employees");
      actions.toast(`${res.employee.name} added.`);
      onClose();
      onCreated(res.employee.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_EMAIL") setErrors({ "account.email": e.message });
      else if (e instanceof ApiError && e.details) setErrors(e.fieldMessages());
      else setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onClose={onClose} labelledBy="emp-t">
      <div id="emp-t" className="dialog-title">
        New employee
      </div>
      {formError ? <AlertBanner>{formError}</AlertBanner> : null}
      <PersonFields f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} errors={errors} />
      {canLogin ? (
        <>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} />
            Create a login account
          </label>
          {withLogin ? (
            <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
              <Field label="Work email" htmlFor="emp-email" error={errors["account.email"]}>
                <input id="emp-email" className="input" type="email" value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} {...invalidProps("emp-email", errors["account.email"])} />
              </Field>
              <Field label="Role" htmlFor="emp-role">
                <select id="emp-role" className="input" value={account.role} onChange={(e) => setAccount({ ...account, role: e.target.value })}>
                  <SelectOptions options={USER_ROLES.map((r) => ({ value: r, label: ROLE_TITLES[r] }))} />
                </select>
              </Field>
              <Field label="Initial password" htmlFor="emp-pw" error={errors["account.password"]} hint="At least 12 characters. Share it securely.">
                <input id="emp-pw" className="input" type="password" autoComplete="new-password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} {...invalidProps("emp-pw", errors["account.password"])} />
              </Field>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Add employee"}
        </Button>
      </div>
    </Dialog>
  );
}
