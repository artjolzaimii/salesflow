import type { Metadata } from "next";
import { CategoriesView } from "@/components/management/reference-tables";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return <CategoriesView />;
}
