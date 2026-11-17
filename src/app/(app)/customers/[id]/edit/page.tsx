import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomerForm } from "@/components/customers/customer-form";
import { SkeletonRows } from "@/components/ui/states";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Edit customer" };

/** Server gate: `customers.update`; record scope is enforced again by the API (404 outside it). */
export default async function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  await requirePagePermission("customers.update");
  return (
    <Suspense fallback={<SkeletonRows />}>
      {params.then(({ id }) => (
        <CustomerForm key={id} customerId={decodeURIComponent(id)} />
      ))}
    </Suspense>
  );
}
