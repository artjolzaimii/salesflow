"use client";

import { useMemo } from "react";
import { sumAll, monthToDate } from "@/lib/analytics";
import { formatWhole } from "@/lib/money";
import { usePreview } from "@/store/preview-store";
import { Blueprint } from "@/components/ui/blueprint";
import { PageHeader } from "@/components/ui/page-header";

export function CategoriesView() {
  const products = usePreview((s) => s.data.products);
  const rows = useMemo(
    () =>
      [...new Set(products.map((p) => p.category))].sort().map((name) => {
        const items = products.filter((p) => p.category === name);
        return { name, count: items.length, active: items.filter((p) => p.active).length, units: [...new Set(items.map((p) => p.unit))].join(", ") };
      }),
    [products],
  );

  return (
    <>
      <PageHeader title="Categories" subtitle="Product groupings used for catalog filters and reports." />
      <Blueprint as="section" className="min-w-0 px-[18px] py-[14px]">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Products</th>
                <th className="text-right">Active</th>
                <th>Units used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-right">{r.count}</td>
                  <td className="text-right">{r.active}</td>
                  <td>{r.units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Blueprint>
    </>
  );
}

export function EmployeesView() {
  const data = usePreview((s) => s.data);
  const today = usePreview((s) => s.today);
  const rows = useMemo(() => {
    const { start } = monthToDate(today);
    return data.employees.map((e) => ({
      ...e,
      customers: data.customers.filter((c) => c.repId === e.id).length,
      orders: data.orders.filter((o) => o.repId === e.id && o.date >= start && o.status !== "Cancelled").length,
      net: sumAll(data.invoices.filter((i) => i.repId === e.id && i.issueDate >= start), "taxable"),
    }));
  }, [data, today]);

  return (
    <>
      <PageHeader title="Employees" subtitle="Sales representatives and their assigned territories. November figures are month to date." />
      <Blueprint as="section" className="min-w-0 px-[18px] py-[14px]">
        <div className="overflow-x-auto">
          <table className="table min-w-[680px]">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Territory</th>
                <th className="text-right">Customers</th>
                <th className="text-right">Orders (Nov)</th>
                <th className="text-right">Net invoiced, ALL (Nov)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-neutral-700">{r.id}</td>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.region}</td>
                  <td className="text-right">{r.customers}</td>
                  <td className="text-right">{r.orders}</td>
                  <td className="num">{formatWhole(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Blueprint>
    </>
  );
}

/** User management and settings are out of scope for this design pass. */
export function AdminPlaceholder() {
  return (
    <Blueprint className="flex max-w-[640px] flex-col gap-[10px] px-7 py-10">
      <span className="tag tag-outline self-start">Not in this design pass</span>
      <h2 className="m-0">Administration screens</h2>
      <p className="m-0">
        User management and settings are scoped for Stage 5. They depend on the auth and role endpoints listed in IMPLEMENTATION.md (GET/POST /api/users,
        PATCH /api/users/:id/role, GET/PUT /api/settings).
      </p>
    </Blueprint>
  );
}
