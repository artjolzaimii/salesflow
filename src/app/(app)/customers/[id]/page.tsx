import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { SkeletonRows } from "@/components/ui/states";

export const metadata: Metadata = { title: "Customer" };

/**
 * Customer IDs are request-time params (new customers can be registered in
 * preview), so the param is resolved inside Suspense per Cache Components.
 */
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
