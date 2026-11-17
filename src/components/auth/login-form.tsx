"use client";

import { useState, useTransition, type FormEvent } from "react";
import { signInAction } from "@/app/actions/auth";
import { validateLogin, type LoginForm as LoginValues } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Field, invalidProps } from "@/components/ui/field";

/**
 * Email/password sign-in through Auth.js (server action). The password is only
 * checked on the server; a failure returns one generic message. Accounts are
 * created by an administrator; there is no self-registration.
 */
export function LoginForm() {
  const [f, setF] = useState<LoginValues>({ email: "", password: "" });
  const [errors, setErrors] = useState<ReturnType<typeof validateLogin>>({});
  const [formError, setFormError] = useState("");
  const [loading, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateLogin(f);
    setErrors(errs);
    setFormError("");
    if (Object.keys(errs).length) return;
    startTransition(async () => {
      // Resolves only on failure; success redirects to the dashboard.
      const res = await signInAction(f);
      if (res.error) {
        setFormError(res.error);
        setF((v) => ({ ...v, password: "" }));
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex w-[min(380px,100%)] flex-col gap-4">
      <div>
        <h2 className="m-0 text-[30px]">Sign in</h2>
        <p className="text-muted mt-1 mb-0 text-[13px]">Use your company account.</p>
      </div>
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
      {formError ? (
        <p role="alert" className="field-error m-0">
          {formError}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={loading} className="min-h-10 text-[15px]">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-muted m-0 text-[12px]">
        Accounts are created by your administrator. Business data on the following screens is still preview data.
      </p>
    </form>
  );
}
