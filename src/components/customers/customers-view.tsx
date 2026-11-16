"use client";

import { useMemo, useState } from "react";
import { API_ENDPOINTS } from "@/services/api";
import { CUSTOMER_OPTIONS } from "@/mocks/fixtures";
import { ROUTES } from "@/lib/navigation";
import { usePreview } from "@/store/preview-store";
import { listState, useRole, useScopedData } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { SelectOptions } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { paginate, Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";

const PAGE_SIZE = 8;
const BLANK = { q: "", city: "all", type: "all", size: "all", rep: "all", status: "all" };

export function CustomersView() {
  const { customers, employees, repName } = useScopedData();
  const dataState = usePreview((s) => s.dataState);
  const role = useRole();
  const go = useGo();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const set = (k: keyof typeof BLANK, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.nipt.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)) &&
        (f.city === "all" || c.city === f.city) &&
        (f.type === "all" || c.type === f.type) &&
        (f.size === "all" || c.size === f.size) &&
        (f.rep === "all" || c.repId === f.rep) &&
        (f.status === "all" || (f.status === "active") === c.active),
    );
  }, [customers, f]);

  const paged = paginate(filtered, page, PAGE_SIZE);
  const state = listState(dataState, paged.rows, "customers", API_ENDPOINTS.customers);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Business customers: supermarkets, groceries, restaurants, hotels and cafés."
        actions={
          role.canCreateCustomers ? (
            <Button variant="primary" icon="plus" onClick={() => go.to(ROUTES.customerNew)}>
              Register customer
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
            <input className="input w-[220px] max-w-full" type="search" aria-label="Search customers" placeholder="Name, NIPT or ID" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="City" value={f.city} onChange={(e) => set("city", e.target.value)}>
              <option value="all">All cities</option>
              <SelectOptions options={CUSTOMER_OPTIONS.cities} />
            </select>
            <select className="input w-auto" aria-label="Business type" value={f.type} onChange={(e) => set("type", e.target.value)}>
              <option value="all">All types</option>
              <SelectOptions options={CUSTOMER_OPTIONS.types} />
            </select>
            <select className="input w-auto" aria-label="Business size" value={f.size} onChange={(e) => set("size", e.target.value)}>
              <option value="all">All sizes</option>
              <SelectOptions options={CUSTOMER_OPTIONS.sizes} />
            </select>
            {!role.scopedToOwnCustomers ? (
              <select className="input w-auto" aria-label="Representative" value={f.rep} onChange={(e) => set("rep", e.target.value)}>
                <option value="all">All representatives</option>
                <SelectOptions options={employees.map((e) => ({ value: e.id, label: e.name }))} />
              </select>
            ) : null}
            <select className="input w-auto" aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="all">Active and inactive</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                <th>ID</th>
                <th>Business name</th>
                <th>NIPT</th>
                <th>City</th>
                <th>Type</th>
                <th>Representative</th>
                <th>Status</th>
                <th className="w-[60px]" />
              </tr>
            </thead>
            <tbody>
              {state.rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => go.customer(c.id)}>
                  <td className="whitespace-nowrap text-neutral-700">{c.id}</td>
                  <td className="font-medium">{c.name}</td>
                  <td className="tabular-nums">{c.nipt}</td>
                  <td>{c.city}</td>
                  <td>
                    {c.type} <span className="cur-suffix">· {c.size}</span>
                  </td>
                  <td>{repName(c.repId)}</td>
                  <td>
                    <StatusBadge label={c.active ? "Active" : "Inactive"} />
                  </td>
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      className="text-[13px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        go.customer(c.id);
                      }}
                    >
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={paged.page} pages={paged.pages} total={paged.total} size={PAGE_SIZE} onPage={setPage} />
      </ListPanel>
    </>
  );
}
