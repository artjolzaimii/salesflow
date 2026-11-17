import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { AdminPlaceholder } from "@/components/management/reference-tables";

export const metadata: Metadata = { title: "User management" };

/** Server-side gate: the role must hold `users.manage` (see src/lib/permissions.ts). */
export default async function UsersPage() {
  await requirePagePermission("users.manage");
  return <AdminPlaceholder />;
}
