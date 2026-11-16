"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { canViewPage, pageFromPath, ROUTES, sectionOf } from "@/lib/navigation";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { GlobalOverlays } from "./global-overlays";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * Signed-in frame. Preview sign-in is a client flag only; production gates these
 * routes with the session from GET /api/auth/session and server-side checks.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const signedIn = usePreview((s) => s.signedIn);
  const mobileOpen = usePreview((s) => s.mobileNavOpen);
  const customers = usePreview((s) => s.data.customers);
  const role = useRole();
  const actions = useActions();

  const page = pageFromPath(pathname);
  const allowed = canViewPage(page, role);
  const customerName =
    page === "customerDetail" ? customers.find((c) => c.id === decodeURIComponent(pathname.split("/")[2] ?? ""))?.name : undefined;

  useEffect(() => {
    if (!signedIn) router.replace(ROUTES.login);
    else if (!allowed) router.replace(ROUTES.dashboard);
  }, [signedIn, allowed, router]);

  if (!signedIn) return null;

  return (
    <div className="flex min-h-screen">
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-[49] bg-[color-mix(in_srgb,var(--color-scrim)_40%,transparent)] nav:hidden"
          onClick={() => actions.setMobileNav(false)}
        />
      ) : null}
      <Sidebar section={sectionOf(page)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar page={allowed ? page : "dashboard"} customerName={customerName} />
        <main className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col gap-6 p-4 nav:px-7 nav:pt-6 nav:pb-10">{allowed ? children : null}</main>
      </div>
      <GlobalOverlays />
    </div>
  );
}
