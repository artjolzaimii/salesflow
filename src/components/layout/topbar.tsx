"use client";

import { useEffect, useMemo, useState } from "react";
import { breadcrumbTrail, sectionOf, SECTION_HREF, type PageKey } from "@/lib/navigation";
import { signOutAction } from "@/app/actions/auth";
import { formatDate } from "@/lib/money";
import { formatDecimal } from "@/lib/decimal-format";
import { invoiceBadges } from "@/lib/invoice-status";
import { useActions } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ThemeMenuItem, ThemeToggle } from "./theme-toggle";
import { qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { CustomerPage, InvoicePage, OrderPage } from "@/services/client/types";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { useDebounced } from "@/services/client/use-debounced";
import { useGo } from "./use-go";

const popover = "absolute z-[60] border border-divider bg-bg shadow-[var(--shadow-md)]";
const popRow = "cursor-pointer hover:bg-accent-100";

export function Topbar({ page, customerName }: { page: PageKey; customerName?: string }) {
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trail = breadcrumbTrail(page, customerName);
  const canPayQuick = !role.canCreateOrders && role.canRegisterPayments;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-divider bg-bg px-5">
      <Button iconOnly icon="menu" aria-label="Open navigation" className="nav:hidden" onClick={() => actions.setMobileNav(true)} />

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-[1_1_auto] items-center gap-2 overflow-x-auto text-[13px] whitespace-nowrap [scrollbar-width:none]">
        {trail.map((t, i) => {
          const last = i === trail.length - 1;
          const link = i === 1 && trail.length === 3;
          return (
            <span key={i} className="contents">
              {i > 0 ? <span className="text-neutral-500">/</span> : null}
              <span
                onClick={link ? () => go.to(SECTION_HREF[sectionOf(page)]) : undefined}
                className={`flex-none ${last ? "font-semibold text-text" : "font-normal text-neutral-700"} ${link ? "cursor-pointer" : "cursor-default"}`}
              >
                {t}
              </span>
            </span>
          );
        })}
        {role.scopedToOwnCustomers ? <span className="tag tag-neutral ml-1">Showing your assigned customers only</span> : null}
      </nav>

      <GlobalSearch
        onOpen={() => {
          setNotifOpen(false);
          setUserOpen(false);
        }}
      />

      {role.canCreateOrders ? (
        <Button variant="primary" icon="plus" onClick={() => go.newOrder()}>
          <span className="max-nav:hidden">New order</span>
        </Button>
      ) : null}
      {canPayQuick ? (
        <Button variant="primary" icon="plus" onClick={() => actions.openPayment()}>
          <span className="max-nav:hidden">Register payment</span>
        </Button>
      ) : null}

      <ThemeToggle className="max-nav:hidden" />

      <Notifications
        open={notifOpen}
        onToggle={() => {
          setNotifOpen(!notifOpen);
          setUserOpen(false);
        }}
        onPick={() => setNotifOpen(false)}
      />

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setUserOpen(!userOpen);
            setNotifOpen(false);
          }}
          aria-label="Account menu"
          aria-expanded={userOpen}
          className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-1"
        >
          <span className="grid h-8 w-8 place-items-center border border-divider font-heading text-[13px] font-semibold text-accent-800">{role.initials}</span>
          <span className="hidden flex-col items-start leading-[1.15] xw:flex">
            <span className="text-[13px] font-medium">{role.user}</span>
            <span className="text-[11px] text-neutral-700">{role.title}</span>
          </span>
          <Icon name="chevD" />
        </button>
        {userOpen ? (
          <div className={`${popover} top-[46px] right-0 w-[240px]`}>
            <div className="border-b border-divider px-[14px] py-3">
              <div className="font-medium">{role.user}</div>
              <div className="text-[12px] text-neutral-700">{role.title}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                setUserOpen(false);
                go.to("/account");
              }}
              className="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-divider bg-transparent px-[14px] py-[10px] text-[13px] hover:bg-accent-100"
            >
              <Icon name="lock" />
              Account security
            </button>
            <ThemeMenuItem className="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-divider bg-transparent px-[14px] py-[10px] text-[13px] hover:bg-accent-100" />
            <button
              type="button"
              onClick={() => {
                setUserOpen(false);
                void signOutAction();
              }}
              className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-[14px] py-[10px] text-[13px] hover:bg-accent-100"
            >
              <Icon name="logout" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Customers, orders and invoices are searched in the database, scoped to the caller by the server. */
function GlobalSearch({ onOpen }: { onOpen: () => void }) {
  const go = useGo();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const term = q.trim().toLowerCase();
  const debounced = useDebounced(term);
  const live = useApiQuery<CustomerPage>(debounced.length >= 2 ? "/api/customers" + qs({ q: debounced, pageSize: 4 }) : null);
  const liveOrders = useApiQuery<OrderPage>(debounced.length >= 2 ? "/api/orders" + qs({ q: debounced, pageSize: 3 }) : null);
  const liveInvoices = useApiQuery<InvoicePage>(debounced.length >= 2 ? "/api/invoices" + qs({ q: debounced, pageSize: 3 }) : null);

  const results = useMemo(() => {
    if (term.length < 2) return [];
    return [
      ...(live.data?.items ?? []).map((c) => ({ key: c.id, kind: "Customer", title: c.businessName, sub: `${c.city} · ${c.nipt}`, pick: () => go.customer(c.id) })),
      ...(liveOrders.data?.items ?? []).map((o) => ({
        key: o.id,
        kind: "Order",
        title: o.orderNumber,
        sub: `${o.customer.businessName} · ${ORDER_STATUS_LABEL[o.status]}`,
        pick: () => go.order(o.id),
      })),
      ...(liveInvoices.data?.items ?? []).map((i) => ({
        key: i.id,
        kind: "Invoice",
        title: i.invoiceNumber,
        sub: `${i.customer.businessName} · ${invoiceBadges(i).join(" · ")}`,
        pick: () => go.invoice(i.id),
      })),
    ];
  }, [term, live.data, liveOrders.data, liveInvoices.data, go]);

  const open = focused && term.length >= 2;

  return (
    <div className="relative min-w-[150px] flex-[0_1_300px]">
      <div className="pointer-events-none absolute top-[10px] left-[10px] text-neutral-600">
        <Icon name="search" />
      </div>
      <input
        className="input bg-transparent pl-8"
        type="search"
        aria-label="Search customers, orders, invoices"
        placeholder="Search customers, orders, invoices"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setFocused(true);
        }}
        onFocus={() => {
          setFocused(true);
          onOpen();
        }}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
      />
      {open ? (
        <div role="listbox" className={`${popover} top-[42px] right-0 left-0 min-w-[300px] py-[6px]`}>
          {results.map((r) => (
            <div
              key={r.kind + r.key}
              role="option"
              aria-selected="false"
              onMouseDown={() => {
                r.pick();
                setQ("");
              }}
              className={`flex items-baseline gap-[10px] px-3 py-[7px] ${popRow}`}
            >
              <span className="w-[72px] flex-none text-[10.5px] tracking-[0.08em] text-neutral-700 uppercase">{r.kind}</span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{r.title}</span>
                <span className="text-[12px] text-neutral-700">{r.sub}</span>
              </span>
            </div>
          ))}
          {results.length === 0 ? <div className="px-3 py-[10px] text-[13px] text-neutral-700">No matches in your accessible records.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

const NOTE_LIMIT = 8;

/** Overdue invoices from the database (oldest due date first), scoped to the caller by the server. */
function Notifications({ open, onToggle, onPick }: { open: boolean; onToggle: () => void; onPick: () => void }) {
  const go = useGo();
  const overdue = useApiQuery<InvoicePage>("/api/invoices" + qs({ status: "OVERDUE", sort: "dueDate", dir: "asc", pageSize: NOTE_LIMIT }));
  const count = overdue.data?.total ?? 0;

  const notes = useMemo(
    () =>
      (overdue.data?.items ?? []).map((i) => ({
        key: i.id,
        title: `${i.invoiceNumber} is overdue`,
        sub: `${i.customer.businessName} · ${formatDecimal(i.outstanding, 2, 2)} ${i.currencyCode} was due ${formatDate(i.dueDate)}`,
        pick: () => go.invoice(i.id),
      })),
    [overdue.data, go],
  );

  return (
    <div className="relative">
      <Button iconOnly icon="bell" aria-label="Notifications" aria-expanded={open} onClick={onToggle} className="relative">
        {count ? (
          <span className="absolute -top-[6px] -right-[6px] grid h-[18px] min-w-[18px] place-items-center bg-danger-600 px-1 text-[11px] text-bg tabular-nums">
            {count}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div className={`${popover} top-11 right-0 w-[340px] max-w-[calc(100vw-32px)]`}>
          <div className="border-b border-divider px-[14px] py-[10px] font-heading text-[16px] font-semibold">Needs attention</div>
          {notes.map((n) => (
            <div
              key={n.key}
              onClick={() => {
                onPick();
                n.pick();
              }}
              className={`flex flex-col gap-[2px] border-b border-hairline px-[14px] py-[10px] ${popRow}`}
            >
              <span className="text-[13px] font-medium">{n.title}</span>
              <span className="text-[12px] text-neutral-700">{n.sub}</span>
            </div>
          ))}
          {notes.length === 0 ? <div className="px-[14px] py-[10px] text-[13px] text-neutral-700">Nothing overdue. You&apos;re all caught up.</div> : null}
          {count > notes.length ? (
            <div
              onClick={() => {
                onPick();
                go.section("invoices");
              }}
              className={`px-[14px] py-2 text-[12px] ${popRow}`}
            >
              {count - notes.length} more overdue · open Invoices
            </div>
          ) : null}
          {notes.length ? <div className="px-[14px] py-2 text-[11px] text-neutral-700">Derived from invoice due dates and recorded payments.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
