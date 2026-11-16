import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
      <div className="flex flex-col justify-between gap-10 bg-accent-900 p-12 text-bg dark:bg-accent-100 dark:text-text">
        <div className="flex items-center gap-[10px]">
          <div className="grid h-[30px] w-[30px] place-items-center border border-accent-400 font-heading dark:border-accent-500 text-[14px] font-semibold">SF</div>
          <span className="font-heading text-[20px] font-semibold">SalesFlow</span>
        </div>
        <div className="flex max-w-[420px] flex-col gap-3">
          <h1 className="m-0 text-[44px] text-bg dark:text-text">Sales management for wholesale and distribution.</h1>
          <p className="m-0 text-[15px] text-accent-300 dark:text-accent-700">
            Customers, orders, invoices and payments in one ledger, with multi-currency and VAT handled on the server.
          </p>
        </div>
        <div className="text-[12px] text-accent-400 dark:text-accent-600">Tiranë · Durrës · Vlorë · Shkodër</div>
      </div>
      <div className="grid place-items-center px-6 py-10">
        <LoginForm />
      </div>
    </div>
  );
}
