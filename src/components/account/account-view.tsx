"use client";

import { useState, type ReactNode } from "react";
import { passwordProblem, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { ROLE_TITLES } from "@/lib/permissions";
import { apiFetch, ApiError, errorMessage } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { AccountDto, MfaEnabledDto, MfaSetupDto, OwnSessionsDto, RecoveryCodesDto } from "@/services/client/types";
import { useActions } from "@/store/preview-store";
import { Panel, PanelHeader } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Field, invalidProps } from "@/components/ui/field";
import { Dialog, KeyValues } from "@/components/ui/overlay";
import { PageHeader } from "@/components/ui/page-header";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";
import { dateTime, OneTimeSecret, SessionsTable } from "./security-parts";

const refresh = () => {
  invalidate("/api/account");
};

/** Account security for the signed-in user: password, MFA and sessions (all checked again on the server). */
export function AccountView() {
  const account = useApiQuery<{ account: AccountDto }>("/api/account");
  const a = account.data?.account;
  return (
    <>
      <PageHeader title="Account security" subtitle="Your password, two-step verification and the devices signed in to your account." />
      {account.loading ? <SkeletonRows /> : null}
      {account.error && !a ? <AlertBanner>{errorMessage(account.error)}</AlertBanner> : null}
      {a ? (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]">
          <Panel className="gap-[14px]">
            <PanelHeader title="Account" />
            <KeyValues
              items={[
                ["Name", a.name],
                ["Email", a.email],
                ["Role", ROLE_TITLES[a.role]],
                ["Password changed", a.passwordChangedAt ? dateTime(a.passwordChangedAt) : "Not since the account was created"],
              ]}
            />
            <PanelHeader as="h4" title="Change password" />
            <PasswordChangeForm mfaEnabled={a.mfa.enabled} email={a.email} onDone={refresh} />
          </Panel>
          <div className="flex flex-col gap-5">
            <MfaPanel account={a} />
            <SessionsPanel />
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ password */

export function PasswordChangeForm({ mfaEnabled, email, onDone, submitLabel = "Change password" }: { mfaEnabled: boolean; email: string; onDone: () => void; submitLabel?: string }) {
  const actions = useActions();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const policy = f.newPassword ? passwordProblem(f.newPassword, { email }) : null;
  const mismatch = f.confirm && f.confirm !== f.newPassword ? "The passwords don't match." : "";

  const save = async () => {
    if (policy || mismatch || !f.currentPassword || !f.newPassword) return;
    setBusy(true);
    setError("");
    setErrs({});
    try {
      const res = await apiFetch<{ otherSessionsRevoked: number }>("/api/account/password", {
        method: "POST",
        body: { currentPassword: f.currentPassword, newPassword: f.newPassword, ...(mfaEnabled ? { code: f.code } : {}) },
      });
      setF({ currentPassword: "", newPassword: "", confirm: "", code: "" });
      actions.toast(`Password changed.${res.otherSessionsRevoked ? ` ${res.otherSessionsRevoked} other session(s) signed out.` : ""}`);
      invalidate("/api/account/sessions");
      onDone();
    } catch (e) {
      if (e instanceof ApiError) setErrs(e.fieldMessages());
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="Current password" htmlFor="pw-current" error={errs.currentPassword}>
        <input id="pw-current" className="input" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => set("currentPassword", e.target.value)} {...invalidProps("pw-current", errs.currentPassword)} />
      </Field>
      <Field label="New password" htmlFor="pw-new" error={errs.newPassword || policy || undefined} hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easier to remember.`}>
        <input id="pw-new" className="input" type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => set("newPassword", e.target.value)} {...invalidProps("pw-new", errs.newPassword || policy || undefined)} />
      </Field>
      <Field label="Repeat new password" htmlFor="pw-confirm" error={mismatch || undefined}>
        <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => set("confirm", e.target.value)} {...invalidProps("pw-confirm", mismatch || undefined)} />
      </Field>
      {mfaEnabled ? (
        <Field label="Code from your authenticator app" htmlFor="pw-code" error={errs.code}>
          <input id="pw-code" className="input" autoComplete="one-time-code" value={f.code} onChange={(e) => set("code", e.target.value)} {...invalidProps("pw-code", errs.code)} />
        </Field>
      ) : null}
      <p className="m-0 text-[12px] text-neutral-700">Your other sessions are signed out. This one stays signed in, since you just confirmed your password.</p>
      {error ? <AlertBanner>{error}</AlertBanner> : null}
      <Button variant="primary" className="self-start" disabled={busy || !!policy || !!mismatch || !f.currentPassword || !f.newPassword || !f.confirm || (mfaEnabled && !f.code)} onClick={save}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ MFA */

function MfaPanel({ account: a }: { account: AccountDto }) {
  const [dialog, setDialog] = useState<"setup" | "disable" | "codes" | null>(null);
  return (
    <Panel className="gap-[12px]">
      <PanelHeader title="Two-step verification" note={a.mfa.enabled ? "On" : "Off"} />
      {a.mfa.enabled ? (
        <>
          <p className="m-0 text-[13.5px]">
            Signing in asks for a code from your authenticator app. Turned on {dateTime(a.mfa.enabledAt)}. Recovery codes left: <strong>{a.mfa.recoveryCodesLeft}</strong>
            {a.mfa.recoveryCodesLeft <= 3 ? " (make new ones soon)" : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog("codes")}>New recovery codes</Button>
            <Button onClick={() => setDialog("disable")}>Turn off</Button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[13.5px]">Add a second step to sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, …). Recommended for administrators and managers.</p>
          {a.mfa.available ? (
            <Button variant="primary" className="self-start" onClick={() => setDialog("setup")}>
              Set up two-step verification
            </Button>
          ) : (
            <AlertBanner>Two-step verification isn&apos;t available yet: the server has no MFA encryption key. Ask your administrator.</AlertBanner>
          )}
        </>
      )}
      {dialog === "setup" ? <MfaSetupDialog email={a.email} onClose={() => setDialog(null)} /> : null}
      {dialog === "disable" ? (
        <ReauthDialog
          title="Turn off two-step verification?"
          body="Signing in will need only your password. Your recovery codes are deleted and your other sessions are signed out."
          action="Turn off"
          onClose={() => setDialog(null)}
          submit={(body) => apiFetch("/api/account/mfa/disable", { method: "POST", body }).then(() => "Two-step verification turned off.")}
        />
      ) : null}
      {dialog === "codes" ? <NewCodesDialog onClose={() => setDialog(null)} /> : null}
    </Panel>
  );
}

/** Password (+ code) confirmation for a sensitive change. */
function ReauthDialog({
  title,
  body,
  action,
  onClose,
  submit,
  needsCode = true,
  children,
}: {
  title: string;
  body: string;
  action: string;
  onClose: () => void;
  submit: (body: { currentPassword: string; code?: string }) => Promise<string | void>;
  needsCode?: boolean;
  children?: ReactNode;
}) {
  const actions = useActions();
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const msg = await submit({ currentPassword: pw, ...(needsCode ? { code } : {}) });
      refresh();
      invalidate("/api/account/sessions");
      if (msg) {
        actions.toast(msg);
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog onClose={busy ? () => {} : onClose} labelledBy="ra-t" width={460}>
      <div id="ra-t" className="dialog-title">
        {title}
      </div>
      <p className="m-0 text-[13.5px]">{body}</p>
      {children}
      <Field label="Current password" htmlFor="ra-pw">
        <input id="ra-pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      {needsCode ? (
        <Field label="Authenticator code or recovery code" htmlFor="ra-code">
          <input id="ra-code" className="input" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      ) : null}
      {error ? <AlertBanner>{error}</AlertBanner> : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={go} disabled={busy || !pw || (needsCode && !code)}>
          {busy ? "Checking…" : action}
        </Button>
      </div>
    </Dialog>
  );
}

function NewCodesDialog({ onClose }: { onClose: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <CodesDialog codes={codes} onClose={onClose} />;
  return (
    <ReauthDialog
      title="Make new recovery codes?"
      body="Your current recovery codes stop working."
      action="Make new codes"
      onClose={onClose}
      submit={async (body) => {
        setCodes((await apiFetch<RecoveryCodesDto>("/api/account/mfa/recovery-codes", { method: "POST", body })).recoveryCodes);
      }}
    />
  );
}

function CodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  return (
    <Dialog onClose={onClose} labelledBy="rc-t" width={460}>
      <div id="rc-t" className="dialog-title">
        Your recovery codes
      </div>
      <p className="m-0 text-[13.5px]">Each code signs you in once if you lose your phone. Keep them somewhere safe, such as a password manager.</p>
      <OneTimeSecret title="Recovery codes" value={codes.join("\n")} testId="recovery-codes" note="Shown only now. We store only a fingerprint of each code." />
      <div className="dialog-actions">
        <Button variant="primary" onClick={onClose}>
          I&apos;ve saved them
        </Button>
      </div>
    </Dialog>
  );
}

function MfaSetupDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const actions = useActions();
  const [setup, setSetup] = useState<MfaSetupDto | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (codes) return <CodesDialog codes={codes} onClose={onClose} />;
  if (!setup) {
    return (
      <ReauthDialog
        title="Set up two-step verification"
        body="Confirm your password to start. You'll scan a QR code with your authenticator app."
        action="Continue"
        needsCode={false}
        onClose={onClose}
        submit={async (body) => {
          setSetup(await apiFetch<MfaSetupDto>("/api/account/mfa/setup", { method: "POST", body }));
        }}
      />
    );
  }
  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<MfaEnabledDto>("/api/account/mfa/enable", { method: "POST", body: { code } });
      refresh();
      invalidate("/api/account/sessions");
      actions.toast("Two-step verification is on.");
      setCodes(res.recoveryCodes);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog onClose={busy ? () => {} : onClose} labelledBy="ms-t" width={480}>
      <div id="ms-t" className="dialog-title">
        Scan with your authenticator app
      </div>
      <div className="flex flex-wrap items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL generated on the server */}
        <img src={setup.qrCode} alt={`QR code for ${email}`} width={168} height={168} className="border border-divider bg-white" />
        <div className="flex min-w-[200px] flex-1 flex-col gap-2 text-[13px]">
          <span>Can&apos;t scan? Enter this key in the app:</span>
          <code data-testid="mfa-secret" className="bg-neutral-200 px-2 py-1 font-mono text-[12.5px] break-all select-all">
            {setup.secret}
          </code>
          <span className="text-neutral-700">Account: {email} · Time-based · 6 digits</span>
        </div>
      </div>
      <Field label="Enter the 6-digit code the app shows" htmlFor="ms-code">
        <input id="ms-code" className="input tracking-[0.12em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </Field>
      {error ? <AlertBanner>{error}</AlertBanner> : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={enable} disabled={busy || code.length !== 6}>
          {busy ? "Verifying…" : "Turn on"}
        </Button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ sessions */

function SessionsPanel() {
  const actions = useActions();
  const q = useApiQuery<OwnSessionsDto>("/api/account/sessions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      actions.toast(done);
      q.refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const sessions = q.data?.items ?? [];
  return (
    <Panel className="gap-[12px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="panel-title">Signed-in devices</h3>
        {sessions.length > 1 ? (
          <Button variant="ghost" className="text-[13px]" disabled={busy} onClick={() => void run(() => apiFetch("/api/account/sessions/revoke-others", { method: "POST", body: {} }), "Other sessions signed out.")}>
            Sign out all other sessions
          </Button>
        ) : null}
      </div>
      {q.loading ? <SkeletonRows /> : null}
      {error ? <AlertBanner>{error}</AlertBanner> : null}
      {q.data ? (
        <SessionsTable
          sessions={sessions}
          busy={busy}
          onRevoke={(id) =>
            void run(async () => {
              const res = await apiFetch<{ current: boolean }>(`/api/account/sessions/${id}`, { method: "DELETE" });
              if (res.current) window.location.assign(new URL("/login", window.location.origin).href);
            }, "Session signed out.")
          }
        />
      ) : null}
      <p className="m-0 text-[12px] text-neutral-700">Sessions end after 8 hours. Changing your password or two-step settings signs out your other sessions.</p>
    </Panel>
  );
}
