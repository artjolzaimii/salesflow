import type { Metadata } from "next";
import { EmployeesView } from "@/components/management/reference-tables";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage() {
  return <EmployeesView />;
}
