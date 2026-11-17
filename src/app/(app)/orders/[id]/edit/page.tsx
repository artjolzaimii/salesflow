import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePagePermission } from "@/server/auth/session";
import { EditOrderForm } from "@/components/orders/order-form";
import { SkeletonRows } from "@/components/ui/states";

export const metadata: Metadata = { title: "Edit order" };

/** Server gate: `orders.update`. Scope, status and the financial lock are enforced again by the API. */
export default async function EditOrderPage({ params }: PageProps<"/orders/[id]/edit">) {
  await requirePagePermission("orders.update");
  return (
    <Suspense fallback={<SkeletonRows />}>
      {params.then(({ id }) => (
        <EditOrderForm key={id} orderId={decodeURIComponent(id)} />
      ))}
    </Suspense>
  );
}
