import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/account/reset-password-form";

export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };

/** Public: completes an account-setup or password-reset link (the token is in the URL fragment). */
export default function ResetPasswordPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6 py-10">
      <ResetPasswordForm />
    </div>
  );
}
