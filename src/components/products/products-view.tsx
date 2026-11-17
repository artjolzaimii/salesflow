"use client";

import { useState } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { CategoryList, ProductPage } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { useActions } from "@/store/preview-store";
import { apiListState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { SelectOptions } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";

const PAGE_SIZE = 25;
const BLANK = { q: "", category: "all", status: "all" };

/** Product catalogue from GET /api/products (search, filters and paging on the server). */
export function ProductsView() {
  const role = useRole();
  const actions = useActions();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const q = useDebounced(f.q.trim());
  const set = (k: keyof typeof BLANK, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  const cats = useApiQuery<CategoryList>("/api/categories");
  const url =
    "/api/products" +
    qs({ q, categoryId: f.category, active: f.status === "all" ? undefined : f.status === "active", page: page + 1, pageSize: PAGE_SIZE, sort: "name" });
  const list = useApiQuery<ProductPage>(url);
  const rows = list.data?.items ?? [];
  const state = apiListState(list, rows, "products", !!q || f.category !== "all" || f.status !== "all");

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
        onClear={() => {
          setF(BLANK);
          setPage(0);
        }}
        filters={
          <FilterRow>
            <input className="input w-[240px] max-w-full" type="search" aria-label="Search products" placeholder="Name or SKU" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="Category" value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="all">All categories</option>
              <SelectOptions options={(cats.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))} />
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
                  <td>{p.category.name}</td>
                  <td>{p.unit}</td>
                  <td className="num">{formatDecimal(p.defaultNetAll)}</td>
                  <td className="text-right">{p.vatRate}%</td>
                  <td>
                    <StatusBadge label={p.isActive ? "Active" : "Inactive"} />
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
        <Pager page={page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} size={PAGE_SIZE} onPage={setPage} />
      </ListPanel>
    </>
  );
}
