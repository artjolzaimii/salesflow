import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { EmployeesView } from "@/components/management/employees-view";

export const metadata: Metadata = { title: "Employees" };

/** Server-side gate: the role must hold `employees.view` (see src/lib/permissions.ts). */
export default async function EmployeesPage() {
  await requirePagePermission("employees.view");
  return <EmployeesView />;
}
