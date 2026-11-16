import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Signed-in application frame: sidebar, top bar, global drawers and dialogs.
 * The shell reads the pathname, which is request-time data on dynamic routes
 * (e.g. /customers/[id]) under Cache Components, so it streams inside Suspense.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
