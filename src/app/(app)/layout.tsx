import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requirePageUser } from "@/server/auth/session";
import { toClientUser } from "@/server/auth/principal";
import { SessionProvider } from "@/store/session";
import { ForcedPasswordChange } from "@/components/account/forced-password-change";

/**
 * Signed-in application frame: sidebar, top bar, global drawers and dialogs.
 * The session is verified on the server (database lookup, so disabled users are
 * rejected); signed-out requests redirect to /login. Session reads are
 * request-time data under Cache Components, so the frame streams inside Suspense.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <SignedIn>{children}</SignedIn>
    </Suspense>
  );
}

async function SignedIn({ children }: { children: ReactNode }) {
  const principal = await requirePageUser();
  // An administrator-set password must be replaced before anything else (the APIs enforce it too).
  if (principal.mustChangePassword) return <ForcedPasswordChange email={principal.email} />;
  return (
    <SessionProvider user={toClientUser(principal)}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
