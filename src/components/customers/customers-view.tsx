"use client";

import { useState } from "react";
import { BUSINESS_SIZE_LABEL, BUSINESS_TYPE_LABEL, CITIES, CUSTOMER_STATUS_LABEL, option } from "@/lib/labels";
import { ROUTES } from "@/lib/navigation";
import { qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { CustomerPage, EmployeePage } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { apiListState, useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { SelectOptions } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";

const PAGE_SIZE = 10;
const BLANK = { q: "", city: "all", type: "all", size: "all", rep: "all", status: "all" };

/** Customers from GET /api/customers. Representatives only ever receive their assigned customers. */
export function CustomersView() {
  const role = useRole();
  const go = useGo();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(0);
  const q = useDebounced(f.q.trim());
  const set = (k: keyof typeof BLANK, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  const reps = useApiQuery<EmployeePage>(role.scopedToOwnCustomers ? null : "/api/employees?active=true&pageSize=100&sort=lastName");
  const list = useApiQuery<CustomerPage>(
    "/api/customers" + qs({ q, city: f.city, businessType: f.type, businessSize: f.size, repId: f.rep, status: f.status, page: page + 1, pageSize: PAGE_SIZE }),
  );
  const filtered = !!q || Object.entries(f).some(([k, v]) => k !== "q" && v !== "all");
  const state = apiListState(list, list.data?.items ?? [], "customers", filtered);

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
            <input className="input w-[220px] max-w-full" type="search" aria-label="Search customers" placeholder="Name, NIPT or city" value={f.q} onChange={(e) => set("q", e.target.value)} />
            <select className="input w-auto" aria-label="City" value={f.city} onChange={(e) => set("city", e.target.value)}>
              <option value="all">All cities</option>
              <SelectOptions options={[...CITIES]} />
            </select>
            <select className="input w-auto" aria-label="Business type" value={f.type} onChange={(e) => set("type", e.target.value)}>
              <option value="all">All types</option>
              <SelectOptions options={option(BUSINESS_TYPE_LABEL)} />
            </select>
            <select className="input w-auto" aria-label="Business size" value={f.size} onChange={(e) => set("size", e.target.value)}>
              <option value="all">All sizes</option>
              <SelectOptions options={option(BUSINESS_SIZE_LABEL)} />
            </select>
            {!role.scopedToOwnCustomers ? (
              <select className="input w-auto" aria-label="Representative" value={f.rep} onChange={(e) => set("rep", e.target.value)}>
                <option value="all">All representatives</option>
                <SelectOptions options={(reps.data?.items ?? []).map((e) => ({ value: e.id, label: e.name }))} />
              </select>
            ) : null}
            <select className="input w-auto" aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="all">All statuses</option>
              <SelectOptions options={option(CUSTOMER_STATUS_LABEL)} />
            </select>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
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
                  <td className="font-medium">{c.businessName}</td>
                  <td className="tabular-nums">{c.nipt}</td>
                  <td>{c.city}</td>
                  <td>
                    {BUSINESS_TYPE_LABEL[c.businessType]}
                    {c.businessSize ? <span className="cur-suffix"> · {BUSINESS_SIZE_LABEL[c.businessSize]}</span> : null}
                  </td>
                  <td>{c.assignedRep?.name ?? <span className="text-muted">Unassigned</span>}</td>
                  <td>
                    <StatusBadge label={CUSTOMER_STATUS_LABEL[c.status]} />
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
        <Pager page={page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} size={PAGE_SIZE} onPage={setPage} />
      </ListPanel>
    </>
  );
}
