"use client";

import { useState, type ReactNode } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { ADDRESS_TYPE_LABEL, BUSINESS_SIZE_LABEL, BUSINESS_TYPE_LABEL, CUSTOMER_STATUS_LABEL, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, paymentTermsDays } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { apiFetch, errorMessage } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { AddressDto, ContactDto, CustomerDetailDto } from "@/services/client/types";
import { useActions } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Blueprint, Panel } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { KeyValues } from "@/components/ui/overlay";
import { EmptyLine, SkeletonRows } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { InvoiceStatusBadges } from "@/components/invoices/invoice-badges";
import { useGo } from "@/components/layout/use-go";
import { AddressDialog, ContactDialog } from "./customer-dialogs";

type Tab = "overview" | "contacts" | "addresses" | "orders" | "invoices" | "payments";

/** Customer detail from GET /api/customers/:id (404 when missing or outside the caller's scope). */
export function CustomerDetail({ id }: { id: string }) {
  const go = useGo();
  const q = useApiQuery<{ customer: CustomerDetailDto }>(`/api/customers/${id}`);
  if (q.loading) return <SkeletonRows />;
  if (!q.data) {
    const missing = q.error?.status === 404;
    return (
      <Blueprint className="flex max-w-[640px] flex-col gap-[10px] px-7 py-10">
        <h2 className="m-0">{missing ? "Customer not found" : "Could not load this customer"}</h2>
        <p className="m-0">{missing ? "No accessible customer has this ID. It may belong to another representative." : errorMessage(q.error)}</p>
        <div className="flex gap-2">
          <Button className="self-start" icon="chevL" onClick={() => go.to(ROUTES.customers)}>
            All customers
          </Button>
          {!missing ? <Button onClick={q.refetch}>Retry</Button> : null}
        </div>
      </Blueprint>
    );
  }
  return <CustomerDetailView c={q.data.customer} />;
}

function CustomerDetailView({ c }: { c: CustomerDetailDto }) {
  const go = useGo();
  const role = useRole();
  const actions = useActions();
  const [tab, setTab] = useState<Tab>("overview");
  const [contactDialog, setContactDialog] = useState<ContactDto | "new" | null>(null);
  const [addressDialog, setAddressDialog] = useState<AddressDto | "new" | null>(null);
  const h = c.history;
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  const address = c.addresses.find((x) => x.isDefault) ?? c.addresses[0];
  const terms = paymentTermsDays(c.businessSize);

  const refresh = () => {
    invalidate(`/api/customers/${c.id}`);
    invalidate("/api/customers?");
  };
  const mutate = async (path: string, method: "PATCH" | "DELETE", body: unknown, done: string) => {
    try {
      await apiFetch(path, { method, body });
      refresh();
      actions.toast(done);
    } catch (e) {
      actions.toast(errorMessage(e));
    }
  };

  const tabs: [Tab, string, string][] = [
    ["overview", "Overview", ""],
    ["contacts", "Contacts", String(c.contacts.length)],
    ["addresses", "Addresses", String(c.addresses.length)],
    ["orders", "Orders", String(h.orderCount)],
    ["invoices", "Invoices", String(h.invoices.length)],
    ["payments", "Payments", String(h.payments.length)],
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="page-title">{c.businessName}</h1>
            <StatusBadge label={CUSTOMER_STATUS_LABEL[c.status]} />
          </div>
          <p className="text-muted m-0 text-[13px]">
            NIPT {c.nipt} · {BUSINESS_TYPE_LABEL[c.businessType]}
            {c.businessSize ? `, ${BUSINESS_SIZE_LABEL[c.businessSize]}` : ""} · {c.city}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon="chevL" onClick={() => go.to(ROUTES.customers)}>
            All customers
          </Button>
          <Button variant={role.canCreateOrders && c.status === "ACTIVE" ? undefined : "primary"} icon="edit" onClick={() => go.to(`/customers/${c.id}/edit`)}>
            Edit customer
          </Button>
          {role.canCreateOrders && c.status === "ACTIVE" ? (
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
                ["Representative", c.assignedRep?.name ?? "Unassigned"],
                ["Payment terms", terms ? `${terms} days` : "Set a business size"],
                ["Last order", h.orders.length ? formatDate(h.orders[0].orderDate) : "No orders yet"],
                ["Primary contact", primary ? [primary.fullName, primary.jobTitle].filter(Boolean).join(", ") : "—"],
                ["Phone", primary?.phone ?? c.phone ?? "—"],
                ["Email", primary?.email ?? c.email ?? "—"],
                ["Address", address ? [address.street, [address.postalCode, address.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "—"],
                ["Customer since", formatDate(c.registeredAt.slice(0, 10))],
                ["Notes", c.notes || "No notes recorded."],
              ]}
            />
          </Panel>
          <Panel className="gap-[10px]">
            <div className="flex items-baseline justify-between">
              <h3 className="panel-title">Financial summary</h3>
              <span className="panel-note">Per currency, not converted</span>
            </div>
            {h.financialSummary.length === 0 ? (
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
                  {h.financialSummary.map((f) => (
                    <tr key={f.currencyCode}>
                      <td className="font-semibold">{f.currencyCode}</td>
                      <td className="num">{formatDecimal(f.invoiced, 2, 2)}</td>
                      <td className="num">{formatDecimal(f.paid, 2, 2)}</td>
                      <td className="num font-medium">{formatDecimal(f.outstanding, 2, 2)}</td>
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
        <TabPanel
          action={
            <Button icon="plus" onClick={() => setContactDialog("new")}>
              Add contact
            </Button>
          }
        >
          <table className="table min-w-[640px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Position</th>
                <th>Phone</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {c.contacts.map((x) => (
                <tr key={x.id}>
                  <td className="font-medium">
                    {x.fullName} {x.isPrimary ? <span className="tag tag-accent ml-1">Primary</span> : null}
                  </td>
                  <td>{x.jobTitle ?? "—"}</td>
                  <td>{x.phone ?? "—"}</td>
                  <td>{x.email ?? "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <Button variant="ghost" className="text-[13px]" onClick={() => setContactDialog(x)}>
                      Edit
                    </Button>
                    {!x.isPrimary ? (
                      <>
                        <Button variant="ghost" className="text-[13px]" onClick={() => mutate(`/api/customers/${c.id}/contacts/${x.id}`, "PATCH", { isPrimary: true }, `${x.fullName} is now the primary contact.`)}>
                          Make primary
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-[13px]"
                          onClick={() =>
                            actions.askConfirm({
                              title: `Remove ${x.fullName}?`,
                              body: "The contact is deleted from this customer.",
                              action: "Remove contact",
                              run: () => mutate(`/api/customers/${c.id}/contacts/${x.id}`, "DELETE", undefined, "Contact removed."),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabPanel>
      ) : null}

      {tab === "addresses" ? (
        <TabPanel
          action={
            <Button icon="plus" onClick={() => setAddressDialog("new")}>
              Add address
            </Button>
          }
        >
          <table className="table min-w-[720px]">
            <thead>
              <tr>
                <th>Type</th>
                <th>Street</th>
                <th>Municipality</th>
                <th>City</th>
                <th>Postal code</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {c.addresses.map((a) => (
                <tr key={a.id}>
                  <td>
                    {ADDRESS_TYPE_LABEL[a.type]} {a.isDefault ? <span className="tag tag-accent ml-1">Default</span> : null}
                  </td>
                  <td>{a.street}</td>
                  <td>{a.municipality ?? "—"}</td>
                  <td>{a.city}</td>
                  <td>{a.postalCode ?? "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <Button variant="ghost" className="text-[13px]" onClick={() => setAddressDialog(a)}>
                      Edit
                    </Button>
                    {!a.isDefault ? (
                      <>
                        <Button variant="ghost" className="text-[13px]" onClick={() => mutate(`/api/customers/${c.id}/addresses/${a.id}`, "PATCH", { isDefault: true }, "Default address changed.")}>
                          Make default
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-[13px]"
                          disabled={a.usedByOrders > 0}
                          title={a.usedByOrders ? "Orders were delivered here; kept for history" : undefined}
                          onClick={() =>
                            actions.askConfirm({
                              title: "Remove this address?",
                              body: `${a.street}, ${a.city} is deleted from this customer.`,
                              action: "Remove address",
                              run: () => mutate(`/api/customers/${c.id}/addresses/${a.id}`, "DELETE", undefined, "Address removed."),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabPanel>
      ) : null}

      {tab === "orders" ? (
        <TabPanel note="Orders from the database. Select one to open it.">
          {h.orders.length === 0 ? (
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
                {h.orders.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => go.order(o.id)}>
                    <td className="font-medium">{o.orderNumber}</td>
                    <td>{formatDate(o.orderDate)}</td>
                    <td>{o.salesRep?.name ?? "—"}</td>
                    <td>{o.currencyCode}</td>
                    <td className="num">{formatDecimal(o.grandTotal, 2, 2)}</td>
                    <td>
                      <span className="inline-flex flex-wrap gap-1">
                        <StatusBadge label={ORDER_STATUS_LABEL[o.status]} bordered />
                        {o.invoiced ? <StatusBadge label="Invoiced" /> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabPanel>
      ) : null}

      {tab === "invoices" ? (
        <TabPanel note>
          {h.invoices.length === 0 ? (
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
                {h.invoices.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => go.invoice(i.id)}>
                    <td className="font-medium">{i.invoiceNumber}</td>
                    <td>{formatDate(i.issueDate)}</td>
                    <td>{formatDate(i.dueDate)}</td>
                    <td>{i.currencyCode}</td>
                    <td className="num">{formatDecimal(i.total, 2, 2)}</td>
                    <td className="num">{formatDecimal(i.outstanding, 2, 2)}</td>
                    <td>
                      <InvoiceStatusBadges paymentStatus={i.paymentStatus} overdue={i.overdue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabPanel>
      ) : null}

      {tab === "payments" ? (
        <TabPanel note>
          {h.payments.length === 0 ? (
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
                {h.payments.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => go.invoice(p.invoiceId)}>
                    <td className="font-medium">{p.reference ?? "—"}</td>
                    <td>{p.invoiceNumber}</td>
                    <td>{formatDate(p.paymentDate)}</td>
                    <td>{PAYMENT_METHOD_LABEL[p.method]}</td>
                    <td className="num">{formatDecimal(p.amount, 2, 2)}</td>
                    <td>{p.currencyCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabPanel>
      ) : null}

      {contactDialog ? <ContactDialog customerId={c.id} contact={contactDialog === "new" ? null : contactDialog} onClose={() => setContactDialog(null)} onSaved={refresh} /> : null}
      {addressDialog ? <AddressDialog customerId={c.id} address={addressDialog === "new" ? null : addressDialog} onClose={() => setAddressDialog(null)} onSaved={refresh} /> : null}
    </>
  );
}

const HISTORY_NOTE = "History from the database (latest 50). Open a row for details; invoices and payments are managed from their drawers.";

function TabPanel({ children, action, note }: { children: ReactNode; action?: ReactNode; note?: boolean | string }) {
  return (
    <Blueprint as="section" className="flex flex-col gap-[10px] px-[18px] py-[14px]">
      {action ? <div className="flex justify-end">{action}</div> : null}
      {note ? (
        <p className="m-0 text-[12px] text-neutral-700">{typeof note === "string" ? note : HISTORY_NOTE}</p>
      ) : null}
      <div className="overflow-x-auto">{children}</div>
    </Blueprint>
  );
}
