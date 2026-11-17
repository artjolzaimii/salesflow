"use client";

import { useEffect, useState } from "react";
import { passwordProblem, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { apiFetch, ApiError } from "@/services/client/http";
import { Button } from "@/components/ui/button";
import { Field, invalidProps } from "@/components/ui/field";

/**
 * Completes an account-setup or password-reset link. The token is read from the
 * URL fragment (never sent to the server in the URL, so it can't end up in
 * access logs or Referer headers) and removed from the address bar at once.
 */
export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // Reading the fragment is a one-time sync with the browser location.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t ?? "");
    if (t) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const policy = pw ? passwordProblem(pw) : null;
  const mismatch = confirm && confirm !== pw ? "The passwords don't match." : "";

  const submit = async () => {
    if (!token || policy || mismatch || !pw) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ email: string }>("/api/password-reset", { method: "POST", body: { token, newPassword: pw } });
      setDone(res.email);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex w-[min(380px,100%)] flex-col gap-4">
        <h2 className="m-0 text-[30px]">Password saved</h2>
        <p className="m-0 text-[14px]">You can now sign in as {done} with your new password.</p>
        <a className="btn btn-primary min-h-10 self-start" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="flex w-[min(380px,100%)] flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <h2 className="m-0 text-[30px]">Set your password</h2>
        <p className="text-muted mt-1 mb-0 text-[13px]">This link from your administrator works once.</p>
      </div>
      {token === "" ? (
        <p role="alert" className="field-error m-0">
          This page needs the full link your administrator sent. Ask them for a new one.
        </p>
      ) : (
        <>
          <Field label="New password" htmlFor="rp-pw" error={policy || undefined} hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
            <input id="rp-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} {...invalidProps("rp-pw", policy || undefined)} />
          </Field>
          <Field label="Repeat new password" htmlFor="rp-confirm" error={mismatch || undefined}>
            <input id="rp-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} {...invalidProps("rp-confirm", mismatch || undefined)} />
          </Field>
          {error ? (
            <p role="alert" className="field-error m-0">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy || !token || !!policy || !!mismatch || !pw || !confirm} className="min-h-10 text-[15px]">
            {busy ? "Saving…" : "Save password"}
          </Button>
        </>
      )}
    </form>
  );
}
