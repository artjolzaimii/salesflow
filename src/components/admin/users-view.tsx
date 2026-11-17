"use client";

import { useState } from "react";
import { ROLE_TITLES, USER_ROLES, type UserRole } from "@/lib/permissions";
import { apiFetch, ApiError, errorMessage, qs } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { EmployeePage, PasswordResetIssuedDto, UserCreatedDto, UserDetailDto, UserPage } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { useActions } from "@/store/preview-store";
import { apiListState } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, SelectOptions } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { Dialog, Drawer, KeyValues } from "@/components/ui/overlay";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { AUDIT_LABEL, dateTime, OneTimeSecret, SessionsTable } from "@/components/account/security-parts";

const PAGE_SIZE = 25;
const BLANK = { q: "", role: "all", status: "all", mfa: "all" };
const roleOptions = USER_ROLES.map((r) => ({ value: r, label: ROLE_TITLES[r] }));

const refreshUsers = (id?: string) => {
  invalidate("/api/users");
  if (id) invalidate(`/api/users/${id}`);
  invalidate("/api/employees");
};

/** User administration from /api/users (administrators only; the server enforces users.manage). */
export function UsersView() {
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(f.q.trim());
  const set = (k: keyof typeof BLANK, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };
  const list = useApiQuery<UserPage>(
    "/api/users" +
      qs({
        q,
        role: f.role,
        active: f.status === "all" ? undefined : f.status === "active",
        mfa: f.mfa === "all" ? undefined : f.mfa === "on",
        page: page + 1,
        pageSize: PAGE_SIZE,
      }),
  );
  const filtered = !!q || f.role !== "all" || f.status !== "all" || f.mfa !== "all";
  const state = apiListState(list, list.data?.items ?? [], "users", filtered);

  return (
    <>
      <PageHeader
        title="User management"
        subtitle="Login accounts, roles and account security. Every change is recorded in the security audit log."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New user
          </Button>
        }
      />
      <ListPanel
        state={state}
        onClear={() => {
          setF(BLANK);
          setPage(0);
        }}
        filters={
          <FilterRow>
            <input className="input w-[260px] max-w-full" type="search" aria-label="Search users" placeholder="Email or employee name" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="Role" value={f.role} onChange={(e) => set("role", e.target.value)}>
              <option value="all">All roles</option>
              <SelectOptions options={roleOptions} />
            </select>
            <select className="input w-auto" aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select className="input w-auto" aria-label="MFA" value={f.mfa} onChange={(e) => set("mfa", e.target.value)}>
              <option value="all">MFA on or off</option>
              <option value="on">MFA on</option>
              <option value="off">MFA off</option>
            </select>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                <th>Email</th>
                <th>Employee</th>
                <th>Role</th>
                <th>MFA</th>
                <th>Last sign-in</th>
                <th className="text-right">Sessions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setOpenId(u.id)}>
                  <td className="font-medium">{u.email}</td>
                  <td>{u.employee?.name ?? <span className="text-muted">No employee</span>}</td>
                  <td>{ROLE_TITLES[u.role]}</td>
                  <td>{u.mfaEnabled ? <span className="tag tag-accent">On</span> : <span className="text-muted">Off</span>}</td>
                  <td className="whitespace-nowrap">{u.lastSignInAt ? dateTime(u.lastSignInAt) : <span className="text-muted">Never</span>}</td>
                  <td className="num">{u.activeSessions}</td>
                  <td>
                    <span className="inline-flex flex-wrap gap-1">
                      <StatusBadge label={u.canSignIn ? "Active" : "Inactive"} />
                      {u.mustChangePassword ? <span className="tag tag-outline">Must change password</span> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} size={PAGE_SIZE} onPage={setPage} />
      </ListPanel>
      {openId ? <UserDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
      {creating ? <CreateUserDialog onClose={() => setCreating(false)} onOpen={(id) => setOpenId(id)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------ create */

function CreateUserDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const actions = useActions();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("SALES_REPRESENTATIVE");
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<UserCreatedDto | null>(null);
  // Active employees without a login account.
  const employees = useApiQuery<EmployeePage>("/api/employees?active=true&pageSize=100&sort=lastName");
  const free = (employees.data?.items ?? []).filter((e) => !e.user);

  const save = async () => {
    setBusy(true);
    setError("");
    setFieldErrs({});
    try {
      const res = await apiFetch<UserCreatedDto>("/api/users", { method: "POST", body: { email, role, ...(employeeId ? { employeeId } : {}) } });
      refreshUsers();
      setCreated(res);
      actions.toast(`${res.user.email} created.`);
    } catch (e) {
      if (e instanceof ApiError) setFieldErrs(e.fieldMessages());
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Dialog onClose={onClose} labelledBy="nu-t">
        <div id="nu-t" className="dialog-title">
          Account created
        </div>
        <p className="m-0 text-[13.5px]">
          Send this one-time setup link to {created.user.email} through a channel you trust. They choose their own password with it. It works once and expires{" "}
          {dateTime(created.setupLink.expiresAt)}.
        </p>
        <OneTimeSecret title="Setup link" value={created.setupLink.url} testId="setup-link" note="Shown only now. It isn't stored; a new link can be issued later." />
        <div className="dialog-actions">
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onOpen(created.user.id);
            }}
          >
            Done
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog onClose={busy ? () => {} : onClose} labelledBy="nu-t">
      <div id="nu-t" className="dialog-title">
        New user
      </div>
      <Field label="Work email" htmlFor="nu-email" error={fieldErrs.email}>
        <input id="nu-email" className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} {...invalidProps("nu-email", fieldErrs.email)} />
      </Field>
      <Field label="Role" htmlFor="nu-role" hint="Managers and administrators see all customers; representatives only their own.">
        <select id="nu-role" className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          <SelectOptions options={roleOptions} />
        </select>
      </Field>
      <Field label="Employee" htmlFor="nu-emp" hint={role === "SALES_REPRESENTATIVE" ? "A representative sees only the customers assigned to this employee." : "Optional."}>
        <select id="nu-emp" className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">No employee record</option>
          <SelectOptions options={free.map((e) => ({ value: e.id, label: e.name }))} />
        </select>
      </Field>
      <p className="m-0 text-[12px] text-neutral-700">No password is set here: you&apos;ll get a one-time setup link to send to the person.</p>
      {error ? <AlertBanner>{error}</AlertBanner> : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={busy || !email.trim()}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ detail */

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApiQuery<{ user: UserDetailDto }>(`/api/users/${id}`);
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<PasswordResetIssuedDto["resetLink"] | null>(null);
  const [role, setRole] = useState<UserRole | "">("");
  const [linking, setLinking] = useState(false);
  const u = q.data?.user;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      actions.toast(done);
      refreshUsers(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>, done: string) => run(() => apiFetch(`/api/users/${id}`, { method: "PATCH", body }), done);
  const confirm = (title: string, body: string, action: string, fn: () => void) => actions.askConfirm({ title, body, action, run: fn });

  return (
    <Drawer
      label="User details"
      width={600}
      onClose={onClose}
      header={
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[24px] break-all">{u?.email ?? "User"}</h2>
          {u ? (
            <span className="inline-flex flex-wrap items-center gap-1 text-[13px] text-neutral-700">
              {ROLE_TITLES[u.role]} · <StatusBadge label={u.canSignIn ? "Active" : "Inactive"} />
              {u.mfaEnabled ? <span className="tag tag-accent">MFA on</span> : null}
            </span>
          ) : null}
        </div>
      }
    >
      {q.loading ? <SkeletonRows /> : null}
      {q.error && !u ? <AlertBanner>{errorMessage(q.error)}</AlertBanner> : null}
      {u ? (
        <>
          {error ? <AlertBanner>{error}</AlertBanner> : null}
          {u.self ? <p className="m-0 text-[12.5px] text-neutral-700">This is your own account: change your password, MFA and sessions from Account security. Another administrator manages your role and status.</p> : null}
          <KeyValues
            items={[
              ["Employee", u.employee ? `${u.employee.name}${u.employee.isActive ? "" : " (inactive)"}` : "No employee record"],
              ["Created", dateTime(u.createdAt)],
              ["Password changed", u.passwordChangedAt ? dateTime(u.passwordChangedAt) : "Never"],
              ["Pending link", u.pendingLink ? `${u.pendingLink.purpose === "SETUP" ? "Setup" : "Reset"} link, expires ${dateTime(u.pendingLink.expiresAt)}` : "None"],
            ]}
          />
          {link ? <OneTimeSecret title="Password reset link" value={link.url} testId="reset-link" note={`Works once, expires ${dateTime(link.expiresAt)}. Shown only now.`} /> : null}

          {!u.self ? (
            <div className="flex flex-col gap-3">
              <h4 className="m-0 text-[16px]">Access</h4>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Role" htmlFor="ud-role">
                  <select id="ud-role" className="input w-auto" value={role || u.role} onChange={(e) => setRole(e.target.value as UserRole)}>
                    <SelectOptions options={roleOptions} />
                  </select>
                </Field>
                <Button
                  disabled={busy || !role || role === u.role}
                  onClick={() =>
                    confirm(`Change role to ${ROLE_TITLES[role as UserRole]}?`, "The change applies immediately and signs the user out of every session.", "Change role", () =>
                      void patch({ role }, "Role changed.").then(() => setRole("")),
                    )
                  }
                >
                  Change role
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {u.isActive ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      confirm(`Deactivate ${u.email}?`, "They are signed out everywhere and can't sign in. Their sales history and attribution stay unchanged.", "Deactivate", () =>
                        void patch({ isActive: false }, "Account deactivated."),
                      )
                    }
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => void patch({ isActive: true }, "Account activated.")}>
                    Activate
                  </Button>
                )}
                <Button
                  disabled={busy || !u.isActive}
                  onClick={() =>
                    confirm("Issue a password reset link?", "The user is signed out everywhere. You'll get a one-time link (24 hours) to send them.", "Issue link", () =>
                      void run(async () => setLink((await apiFetch<PasswordResetIssuedDto>(`/api/users/${id}/password-reset`, { method: "POST", body: {} })).resetLink), "Reset link issued."),
                    )
                  }
                >
                  Reset password
                </Button>
                {u.mfaEnabled ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      confirm("Reset MFA?", "Use this only when the person lost their authenticator. MFA turns off, recovery codes are deleted and they're signed out.", "Reset MFA", () =>
                        void run(() => apiFetch(`/api/users/${id}/mfa/reset`, { method: "POST", body: {} }), "MFA reset."),
                      )
                    }
                  >
                    Reset MFA
                  </Button>
                ) : null}
                <Button disabled={busy} onClick={() => setLinking(true)}>
                  {u.employee ? "Change employee" : "Link employee"}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h4 className="m-0 text-[16px]">Active sessions</h4>
              {!u.self && u.sessions.length ? (
                <Button variant="ghost" className="text-[13px]" disabled={busy} onClick={() => void run(() => apiFetch(`/api/users/${id}/sessions/revoke`, { method: "POST", body: {} }), "All sessions revoked.")}>
                  Revoke all
                </Button>
              ) : null}
            </div>
            <SessionsTable
              sessions={u.sessions}
              busy={busy}
              onRevoke={u.self ? undefined : (sid) => void run(() => apiFetch(`/api/users/${id}/sessions/revoke`, { method: "POST", body: { sessionId: sid } }), "Session revoked.")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="m-0 text-[16px]">Security events</h4>
            {u.events.length === 0 ? (
              <p className="text-muted m-0 text-[13px]">No events recorded.</p>
            ) : (
              <table className="table text-[13px]">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Event</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {u.events.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">{dateTime(e.createdAt)}</td>
                      <td>
                        {AUDIT_LABEL[e.type] ?? e.type}
                        {e.type === "ROLE_CHANGED" && e.details && typeof e.details === "object" && "to" in e.details ? (
                          <span className="text-neutral-700"> → {ROLE_TITLES[(e.details as { to: UserRole }).to]}</span>
                        ) : null}
                      </td>
                      <td className="text-neutral-700">{e.actor ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {linking ? <LinkEmployeeDialog user={u} onClose={() => setLinking(false)} onSave={(employeeId) => void patch({ employeeId }, "Employee link updated.").then(() => setLinking(false))} /> : null}
        </>
      ) : null}
    </Drawer>
  );
}

function LinkEmployeeDialog({ user, onClose, onSave }: { user: UserDetailDto; onClose: () => void; onSave: (employeeId: string | null) => void }) {
  const employees = useApiQuery<EmployeePage>("/api/employees?pageSize=100&sort=lastName");
  const [value, setValue] = useState(user.employee?.id ?? "");
  const options = (employees.data?.items ?? []).filter((e) => !e.user || e.id === user.employee?.id);
  return (
    <Dialog onClose={onClose} labelledBy="le-t" width={440} zIndex={85}>
      <div id="le-t" className="dialog-title">
        Employee for {user.email}
      </div>
      <Field label="Employee" htmlFor="le-emp" hint="Changing the link signs the user out; past orders keep the representative they were recorded with.">
        <select id="le-emp" className="input" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">No employee record</option>
          <SelectOptions options={options.map((e) => ({ value: e.id, label: `${e.name}${e.isActive ? "" : " (inactive)"}` }))} />
        </select>
      </Field>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={value === (user.employee?.id ?? "")} onClick={() => onSave(value || null)}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}
