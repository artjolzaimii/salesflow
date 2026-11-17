import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { CustomerForm } from "@/components/customers/customer-form";

export const metadata: Metadata = { title: "Register customer" };

/** Server-side gate: the role must hold `customers.create` (see src/lib/permissions.ts). */
export default async function CustomersNewPage() {
  await requirePagePermission("customers.create");
  return <CustomerForm />;
}
