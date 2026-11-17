import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { CategoriesView } from "@/components/management/reference-tables";

export const metadata: Metadata = { title: "Categories" };

/** Server-side gate: the role must hold `categories.manage` (see src/lib/permissions.ts). */
export default async function CategoriesPage() {
  await requirePagePermission("categories.manage");
  return <CategoriesView />;
}
