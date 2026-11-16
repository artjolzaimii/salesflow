"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { ROUTES, SECTION_HREF, type SectionKey } from "@/lib/navigation";
import { useActions } from "@/store/preview-store";

/**
 * Navigation helpers mirroring the prototype's `go(page, extra)`: moving to a
 * page closes transient overlays and scrolls to the top; "open" helpers land on
 * the owning list page with its detail drawer open.
 */
export function useGo() {
  const router = useRouter();
  const pathname = usePathname();
  const actions = useActions();

  return useMemo(() => {
    const push = (href: string) => {
      if (pathname !== href) router.push(href);
      try {
        window.scrollTo(0, 0);
      } catch {
        /* non-browser */
      }
    };
    return {
      to: (href: string) => {
        actions.closeOverlays();
        push(href);
      },
      section: (key: SectionKey) => {
        actions.closeOverlays();
        push(SECTION_HREF[key]);
      },
      order: (id: string) => {
        actions.openOrder(id);
        push(ROUTES.orders);
      },
      invoice: (id: string) => {
        actions.openInvoice(id);
        push(ROUTES.invoices);
      },
      customer: (id: string) => {
        actions.closeOverlays();
        push(ROUTES.customer(id));
      },
      newOrder: (customerId = "") => {
        actions.startOrder(customerId);
        actions.closeOverlays();
        push(ROUTES.newOrder);
      },
    };
  }, [router, pathname, actions]);
}
