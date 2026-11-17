import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePagePermission } from "@/server/auth/session";
import { NewOrderForm } from "@/components/orders/order-form";
import { SkeletonRows } from "@/components/ui/states";

export const metadata: Metadata = { title: "New order" };

/** Server-side gate: the role must hold `orders.create` (see src/lib/permissions.ts). `?customer=<id>` preselects a customer. */
export default async function OrdersNewPage({ searchParams }: PageProps<"/orders/new">) {
  await requirePagePermission("orders.create");
  return (
    <Suspense fallback={<SkeletonRows />}>
      {searchParams.then((sp) => {
        const customer = typeof sp.customer === "string" ? sp.customer : undefined;
        return <NewOrderForm key={customer ?? "new"} customerId={customer} />;
      })}
    </Suspense>
  );
}
