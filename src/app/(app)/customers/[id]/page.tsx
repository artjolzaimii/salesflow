import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { SkeletonRows } from "@/components/ui/states";

export const metadata: Metadata = { title: "Customer" };

/** Customer ids are request-time params, resolved inside Suspense per Cache Components. Data: GET /api/customers/:id. */
export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<SkeletonRows />}>
      {params.then(({ id }) => {
        const customerId = decodeURIComponent(id);
        return <CustomerDetail key={customerId} id={customerId} />;
      })}
    </Suspense>
  );
}
