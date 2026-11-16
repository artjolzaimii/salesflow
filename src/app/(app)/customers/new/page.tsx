import type { Metadata } from "next";
import { CustomerForm } from "@/components/customers/customer-form";

export const metadata: Metadata = { title: "Register customer" };

export default function CustomersNewPage() {
  return <CustomerForm />;
}
