"use client";

import { useMemo, useState } from "react";
import { API_ENDPOINTS } from "@/services/api";
import { formatMoney } from "@/lib/money";
import { useActions, usePreview } from "@/store/preview-store";
import { listState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { SelectOptions } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

const BLANK = { q: "", category: "all", status: "all" };

export function ProductsView() {
  const products = usePreview((s) => s.data.products);
  const dataState = usePreview((s) => s.dataState);
  const role = useRole();
  const actions = useActions();
  const [f, setF] = useState(BLANK);
  const set = (k: keyof typeof BLANK, v: string) => setF((x) => ({ ...x, [k]: v }));

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);
  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) &&
        (f.category === "all" || p.category === f.category) &&
        (f.status === "all" || (f.status === "active") === p.active),
    );
  }, [products, f]);
  const state = listState(dataState, filtered, "products", API_ENDPOINTS.products);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Default prices are net, in ALL, excluding VAT."
        actions={
          role.canEditProducts ? (
            <Button variant="primary" icon="plus" onClick={() => actions.openProduct()}>
              New product
            </Button>
          ) : null
        }
      />
      <ListPanel
        state={state}
        onClear={() => setF(BLANK)}
        filters={
          <FilterRow>
            <input className="input w-[240px] max-w-full" type="search" aria-label="Search products" placeholder="Name or SKU" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="Category" value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="all">All categories</option>
              <SelectOptions options={categories} />
            </select>
            <select className="input w-auto" aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="all">Active and inactive</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Unit</th>
                <th className="text-right">Net price (ALL)</th>
                <th className="text-right">VAT</th>
                <th>Status</th>
                <th className="w-[60px]" />
              </tr>
            </thead>
            <tbody>
              {state.rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td className="tabular-nums">{p.sku}</td>
                  <td>{p.category}</td>
                  <td>{p.unit}</td>
                  <td className="num">{formatMoney(p.price)}</td>
                  <td className="text-right">{p.vatRate}%</td>
                  <td>
                    <StatusBadge label={p.active ? "Active" : "Inactive"} />
                  </td>
                  <td className="text-right">
                    {role.canEditProducts ? (
                      <Button variant="ghost" className="text-[13px]" onClick={() => actions.openProduct(p.id)}>
                        Edit
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListPanel>
    </>
  );
}
