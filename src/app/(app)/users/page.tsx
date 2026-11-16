import type { Metadata } from "next";
import { AdminPlaceholder } from "@/components/management/reference-tables";

export const metadata: Metadata = { title: "User management" };

export default function UsersPage() {
  return <AdminPlaceholder />;
}
