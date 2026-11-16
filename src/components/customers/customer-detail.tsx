"use client";

import { useState, type ReactNode } from "react";
import { paymentTermsDays } from "@/mocks/fixtures";
import { formatDate, formatMoney } from "@/lib/money";
import { CURRENCIES } from "@/lib/types";
import { ROUTES } from "@/lib/navigation";
import { useRole, useScopedData } from "@/store/hooks";
import { Blueprint, Panel } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { KeyValues } from "@/components/ui/overlay";
import { EmptyLine } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGo } from "@/components/layout/use-go";

type Tab = "overview" | "contacts" | "addresses" | "orders" | "invoices" | "payments";

export function CustomerDetail({ id }: { id: string }) {
  const { customers, orders, invoices, payments, repName } = useScopedData();
  const role = useRole();
  const go = useGo();
  const [tab, setTab] = useState<Tab>("overview");

  const c = customers.find((x) => x.id === id);
  if (!c) {
    return (
      <Blueprint className="flex max-w-[640px] flex-col gap-[10px] px-7 py-10">
        <h2 className="m-0">Customer not found</h2>
        <p className="m-0">
          No accessible customer has the ID {id}. It may belong to another representative, or the preview data was reset on reload.
        </p>
        <Button className="self-start" icon="chevL" onClick={() => go.to(ROUTES.customers)}>
          All customers
        </Button>
      </Blueprint>
    );
  }

  const co = orders.filter((o) => o.customerId === c.id);
  const ci = invoices.filter((i) => i.customerId === c.id);
  const cp = payments.filter((p) => p.customerId === c.id);
  const tabs: [Tab, string, string][] = [
    ["overview", "Overview", ""],
    ["contacts", "Contacts", "1"],
    ["addresses", "Addresses", "1"],
    ["orders", "Orders", String(co.length)],
    ["invoices", "Invoices", String(ci.length)],
    ["payments", "Payments", String(cp.length)],
  ];
  const fin = CURRENCIES.map((cur) => {
    const a = ci.filter((i) => i.currency === cur);
    if (!a.length) return null;
    return {
      cur,
      inv: formatMoney(a.reduce((x, i) => x + i.total, 0), cur),
      paid: formatMoney(a.reduce((x, i) => x + i.paid, 0), cur),
      out: formatMoney(a.reduce((x, i) => x + i.outstanding, 0), cur),
      overdue: String(a.filter((i) => i.status === "Overdue").length),
    };
  }).filter((x) => x !== null);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="page-title">{c.name}</h1>
            <StatusBadge label={c.active ? "Active" : "Inactive"} />
          </div>
          <p className="text-muted m-0 text-[13px]">
            {c.id} · NIPT {c.nipt} · {c.type}, {c.size} · {c.city}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon="chevL" onClick={() => go.to(ROUTES.customers)}>
            All customers
          </Button>
          {role.canCreateOrders && c.active ? (
            <Button variant="primary" icon="plus" onClick={() => go.newOrder(c.id)}>
              New order
            </Button>
          ) : null}
        </div>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-divider">
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px flex cursor-pointer gap-[6px] border-0 border-b-2 bg-transparent px-3 py-2 text-[14px] whitespace-nowrap ${
              tab === k ? "border-accent text-text" : "border-transparent text-neutral-700"
            }`}
          >
            {label}
            {n ? <span className="text-[12px] text-neutral-700 tabular-nums">{n}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
          <Panel className="gap-[10px]">
            <h3 className="panel-title">Account</h3>
            <KeyValues
              items={[
                ["Representative", repName(c.repId)],
                ["Payment terms", `${paymentTermsDays(c.size)} days`],
                ["Last order", co.length ? formatDate(co[0].date) : "No orders yet"],
                ["Primary contact", `${c.contactName}, ${c.contactPosition}`],
                ["Phone", c.phone],
                ["Address", `${c.street}, ${c.postalCode} ${c.city}`],
                ["Notes", c.notes || "No notes recorded."],
              ]}
            />
          </Panel>
          <Panel className="gap-[10px]">
            <div className="flex items-baseline justify-between">
              <h3 className="panel-title">Financial summary</h3>
              <span className="panel-note">Per currency, not converted</span>
            </div>
            {fin.length === 0 ? (
              <p className="text-muted m-0">No invoices issued to this customer yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Cur.</th>
                    <th className="text-right">Invoiced</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th className="text-right">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {fin.map((f) => (
                    <tr key={f.cur}>
                      <td className="font-semibold">{f.cur}</td>
                      <td className="num">{f.inv}</td>
                      <td className="num">{f.paid}</td>
                      <td className="num font-medium">{f.out}</td>
                      <td className="text-right">{f.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "contacts" ? (
        <TabPanel>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Position</th>
                <th>Phone</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium">{c.contactName}</td>
                <td>{c.contactPosition}</td>
                <td>{c.phone}</td>
                <td>{c.email}</td>
              </tr>
            </tbody>
          </table>
        </TabPanel>
      ) : null}

      {tab === "addresses" ? (
        <TabPanel>
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Street</th>
                <th>Municipality</th>
                <th>City</th>
                <th>Postal code</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{c.addressType}</td>
                <td>{c.street}</td>
                <td>{c.municipality}</td>
                <td>{c.city}</td>
                <td>{c.postalCode}</td>
              </tr>
            </tbody>
          </table>
        </TabPanel>
      ) : null}

      {tab === "orders" ? (
        <TabPanel>
          {co.length === 0 ? (
            <EmptyLine>No orders for this customer.</EmptyLine>
          ) : (
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Representative</th>
                  <th>Cur.</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {co.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => go.order(o.id)}>
                    <td className="font-medium">{o.id}</td>
                    <td>{formatDate(o.date)}</td>
                    <td>{repName(o.repId)}</td>
                    <td>{o.currency}</td>
                    <td className="num">{formatMoney(o.total)}</td>
                    <td>
                      <StatusBadge label={o.status} bordered />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabPanel>
      ) : null}

      {tab === "invoices" ? (
        <TabPanel>
          {ci.length === 0 ? (
            <EmptyLine>No invoices for this customer.</EmptyLine>
          ) : (
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th>Cur.</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ci.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => go.invoice(i.id)}>
                    <td className="font-medium">{i.id}</td>
                    <td>{formatDate(i.issueDate)}</td>
                    <td>{formatDate(i.dueDate)}</td>
                    <td>{i.currency}</td>
                    <td className="num">{formatMoney(i.total)}</td>
                    <td className="num">{formatMoney(i.outstanding)}</td>
                    <td>
                      <StatusBadge label={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabPanel>
      ) : null}

      {tab === "payments" ? (
        <TabPanel>
          {cp.length === 0 ? (
            <EmptyLine>No payments recorded for this customer.</EmptyLine>
          ) : (
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th className="text-right">Amount</th>
                  <th>Cur.</th>
                </tr>
              </thead>
              <tbody>
                {cp.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => go.invoice(p.invoiceId)}>
                    <td className="font-medium">{p.reference}</td>
                    <td>{p.invoiceId}</td>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.method}</td>
                    <td className="num">{formatMoney(p.amount)}</td>
                    <td>{p.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabPanel>
      ) : null}
    </>
  );
}

function TabPanel({ children }: { children: ReactNode }) {
  return (
    <Blueprint as="section" className="px-[18px] py-[14px]">
      <div className="overflow-x-auto">{children}</div>
    </Blueprint>
  );
}
