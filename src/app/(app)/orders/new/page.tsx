import type { Metadata } from "next";
import { NewOrderForm } from "@/components/orders/new-order-form";

export const metadata: Metadata = { title: "New order" };

export default function OrdersNewPage() {
  return <NewOrderForm />;
}
