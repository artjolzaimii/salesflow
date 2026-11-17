"use client";

import { useState, useTransition, type FormEvent } from "react";
import { signInAction } from "@/app/actions/auth";
import { validateLogin, type LoginForm as LoginValues } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Field, invalidProps } from "@/components/ui/field";

/**
 * Email/password sign-in through Auth.js (server action), with a second step
 * for accounts with MFA. The password and code are only checked on the server;
 * a failure returns one generic message. Accounts are created by an
 * administrator; there is no self-registration.
 */
export function LoginForm() {
  const [f, setF] = useState<LoginValues>({ email: "", password: "" });
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof validateLogin>>({});
  const [formError, setFormError] = useState("");
  const [loading, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = mfa ? {} : validateLogin(f);
    setErrors(errs);
    setFormError("");
    if (Object.keys(errs).length) return;
    if (mfa && !code.trim()) return setFormError("Enter the code from your authenticator app, or a recovery code.");
    startTransition(async () => {
      // Resolves only on failure or when a code is needed; success redirects to the dashboard.
      const res = await signInAction(mfa ? { ...f, code: code.trim() } : f);
      if (res.mfaRequired) {
        setMfa(true);
        setCode("");
        setFormError(res.error);
        return;
      }
      if (res.error) {
        setFormError(res.error);
        setF((v) => ({ ...v, password: "" }));
      }
    });
  };

  const back = () => {
    setMfa(false);
    setCode("");
    setFormError("");
    setF((v) => ({ ...v, password: "" }));
  };

  return (
    <form onSubmit={submit} noValidate className="flex w-[min(380px,100%)] flex-col gap-4">
      <div>
        <h2 className="m-0 text-[30px]">{mfa ? "Two-step verification" : "Sign in"}</h2>
        <p className="text-muted mt-1 mb-0 text-[13px]">{mfa ? `Enter the 6-digit code from your authenticator app for ${f.email}, or one of your recovery codes.` : "Use your company account."}</p>
      </div>
      {mfa ? (
        <Field label="Verification code" htmlFor="lg-code">
          <input
            id="lg-code"
            className="input tracking-[0.12em]"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            maxLength={40}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      ) : (
        <>
          <Field label="Work email" htmlFor="lg-email" error={errors.email}>
            <input
              id="lg-email"
              className="input"
              type="email"
              autoComplete="username"
              placeholder="name@company.al"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              {...invalidProps("lg-email", errors.email)}
            />
          </Field>
          <Field label="Password" htmlFor="lg-pw" error={errors.password}>
            <input
              id="lg-pw"
              className="input"
              type="password"
              autoComplete="current-password"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              {...invalidProps("lg-pw", errors.password)}
            />
          </Field>
        </>
      )}
      {formError ? (
        <p role="alert" className="field-error m-0">
          {formError}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={loading} className="min-h-10 text-[15px]">
        {loading ? (mfa ? "Verifying…" : "Signing in…") : mfa ? "Verify and sign in" : "Sign in"}
      </Button>
      {mfa ? (
        <Button type="button" variant="ghost" onClick={back} className="self-start text-[13px]">
          Use a different account
        </Button>
      ) : (
        <p className="text-muted m-0 text-[12px]">Accounts are created by your administrator. Forgot your password? Ask your administrator for a reset link.</p>
      )}
    </form>
  );
}
