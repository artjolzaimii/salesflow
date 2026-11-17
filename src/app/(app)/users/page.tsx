import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { UsersView } from "@/components/admin/users-view";

export const metadata: Metadata = { title: "User management" };

/** Server-side gate: the role must hold `users.manage` (see src/lib/permissions.ts). */
export default async function UsersPage() {
  await requirePagePermission("users.manage");
  return <UsersView />;
}
