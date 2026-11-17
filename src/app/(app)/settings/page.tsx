import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { AdminPlaceholder } from "@/components/management/reference-tables";

export const metadata: Metadata = { title: "Settings" };

/** Server-side gate: the role must hold `settings.manage` (see src/lib/permissions.ts). */
export default async function SettingsPage() {
  await requirePagePermission("settings.manage");
  return <AdminPlaceholder />;
}
