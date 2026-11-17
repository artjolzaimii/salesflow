"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { canViewPage, pageFromPath, ROUTES, sectionOf } from "@/lib/navigation";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { PreviewNotice } from "@/components/ui/preview-notice";
import { useApiQuery } from "@/services/client/query";
import { GlobalOverlays } from "./global-overlays";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * Signed-in frame. The (app) layout has already verified the session on the
 * server; this only hides sections the role cannot open (the server pages
 * enforce the same rule).
 */
/**
 * Sections that still run on fictional fixtures until their backend phase.
 * Customers, products, categories, employees and exchange rates are live.
 */
const PREVIEW_SECTIONS: Partial<Record<ReturnType<typeof sectionOf>, string>> = {
  dashboard: "The dashboard figures",
  invoices: "Invoices",
  payments: "Payments",
  reports: "Reports",
  assistant: "AI Assistant conversations",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const mobileOpen = usePreview((s) => s.mobileNavOpen);
  const role = useRole();
  const actions = useActions();

  const page = pageFromPath(pathname);
  const allowed = canViewPage(page, role);
  // Same cached request as the customer page itself, so no extra round trip.
  const customerId = page === "customerDetail" ? decodeURIComponent(pathname.split("/")[2] ?? "") : "";
  const customerQuery = useApiQuery<{ customer: { businessName: string } }>(/^[0-9a-f-]{36}$/i.test(customerId) ? `/api/customers/${customerId}` : null);
  const customerName = customerQuery.data?.customer.businessName;

  useEffect(() => {
    if (!allowed) router.replace(ROUTES.dashboard);
  }, [allowed, router]);

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
        <main className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col gap-6 p-4 nav:px-7 nav:pt-6 nav:pb-10">
          {allowed && PREVIEW_SECTIONS[sectionOf(page)] ? <PreviewNotice module={PREVIEW_SECTIONS[sectionOf(page)]!} /> : null}
          {allowed ? children : null}
        </main>
      </div>
      <GlobalOverlays />
    </div>
  );
}
