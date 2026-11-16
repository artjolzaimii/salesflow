"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ROUTES } from "@/lib/navigation";
import { validateLogin, type LoginForm as LoginValues } from "@/lib/validation";
import { useActions } from "@/store/preview-store";
import { Button } from "@/components/ui/button";
import { Field, invalidProps } from "@/components/ui/field";

/**
 * Preview sign-in: any valid email and an 8+ character password. No credentials
 * leave the browser; production posts to POST /api/auth/login.
 */
export function LoginForm() {
  const router = useRouter();
  const actions = useActions();
  const [f, setF] = useState<LoginValues>({ email: "", password: "" });
  const [errors, setErrors] = useState<ReturnType<typeof validateLogin>>({});
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateLogin(f);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    timer.current = setTimeout(() => {
      actions.signIn();
      setLoading(false);
      setF({ email: "", password: "" });
      router.push(ROUTES.dashboard);
    }, 900);
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
      <Button type="submit" variant="primary" disabled={loading} className="min-h-10 text-[15px]">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-muted m-0 text-[12px]">
        Preview: any valid email and a password of 8+ characters signs in. Production authenticates via POST /api/auth/login.
      </p>
    </form>
  );
}
