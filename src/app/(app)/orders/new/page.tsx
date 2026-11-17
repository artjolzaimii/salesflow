import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { NewOrderForm } from "@/components/orders/new-order-form";

export const metadata: Metadata = { title: "New order" };

/** Server-side gate: the role must hold `orders.create` (see src/lib/permissions.ts). */
export default async function OrdersNewPage() {
  await requirePagePermission("orders.create");
  return <NewOrderForm />;
}
