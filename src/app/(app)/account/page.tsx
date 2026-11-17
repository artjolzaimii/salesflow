import type { Metadata } from "next";
import { AccountView } from "@/components/account/account-view";

export const metadata: Metadata = { title: "Account security" };

/** Every signed-in user manages their own password, MFA and sessions (the (app) layout verified the session). */
export default function AccountPage() {
  return <AccountView />;
}
