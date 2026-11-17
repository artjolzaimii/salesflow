"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { businessDate } from "@/lib/business-date";
import { formatDecimal } from "@/lib/decimal-format";
import { ADDRESS_TYPE_LABEL, BUSINESS_TYPE_LABEL, CURRENCY_CODES, type CurrencyCode } from "@/lib/labels";
import { formatDate } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { catalogueUnitPrice, estimateLine, estimateTotals, toAllEstimate, type EstimateTotals } from "@/lib/order-estimate";
import { orderBodySchema } from "@/lib/schemas/orders";
import { apiFetch, ApiError, errorMessage, qs } from "@/services/client/http";
import { useApiQuery } from "@/services/client/query";
import type { ApplicableRateDto, CustomerDetailDto, CustomerPage, CustomerRow, EmployeePage, OrderDetailDto, OrderQuoteDto, ProductPage, ProductRow } from "@/services/client/types";
import { useDebounced } from "@/services/client/use-debounced";
import { useActions } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Blueprint, Panel } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, Segmented, SelectOptions } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SearchSelect } from "@/components/ui/search-select";
import { AlertBanner, SkeletonRows } from "@/components/ui/states";
import { useGo } from "@/components/layout/use-go";
import { refreshOrder } from "./order-drawer";

/* ------------------------------------------------------------------ model */

interface LineProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  /** Catalogue net ALL and current VAT, for the browser estimate only. */
  defaultNetAll: string;
  vatRate: string;
}

interface Line {
  key: number;
  /** Existing order item (edit), so an unchanged manager price survives. */
  itemId?: string;
  product: LineProduct | null;
  quantity: string;
  /** null = catalogue price at the order rate; a string = price entered by a manager. */
  price: string | null;
  discount: string;
}

interface CustomerRef {
  id: string;
  label: string;
  hint: string;
  assignedRepId: string | null;
}

interface Initial {
  orderId?: string;
  orderNumber?: string;
  status?: string;
  version?: string;
  customer: CustomerRef | null;
  repId: string;
  repName?: string;
  date: string;
  deliveryId: string; // "" = customer's default address, "pickup", or an address id
  deliveryLabel?: string;
  currency: CurrencyCode;
  lines: Line[];
}

let lineKey = 1;
const blankLine = (): Line => ({ key: lineKey++, product: null, quantity: "", price: null, discount: "0" });

const customerRef = (c: { id: string; businessName: string; nipt: string; city: string; businessType: keyof typeof BUSINESS_TYPE_LABEL; assignedRep?: { id: string } | null }): CustomerRef => ({
  id: c.id,
  label: `${c.businessName} · ${c.city}`,
  hint: `${c.nipt} · ${BUSINESS_TYPE_LABEL[c.businessType]} · ${c.city}`,
  assignedRepId: c.assignedRep?.id ?? null,
});

/* -------------------------------------------------------------- entries */

/** New order (optionally for a customer chosen elsewhere, e.g. the customer page). */
export function NewOrderForm({ customerId }: { customerId?: string }) {
  const prefill = useApiQuery<{ customer: CustomerDetailDto }>(customerId ? `/api/customers/${encodeURIComponent(customerId)}` : null);
  const [today] = useState(() => businessDate());
  if (customerId && prefill.loading) return <SkeletonRows />;
  const c = prefill.data?.customer;
  const initial: Initial = {
    customer: c && c.status === "ACTIVE" ? customerRef(c) : null,
    repId: "",
    date: today,
    deliveryId: "",
    currency: "ALL",
    lines: [blankLine()],
  };
  return <OrderEditor key={c?.id ?? "new"} initial={initial} />;
}

/** Edit an existing draft or confirmed, never-invoiced order. */
export function EditOrderForm({ orderId }: { orderId: string }) {
  const go = useGo();
  const q = useApiQuery<{ order: OrderDetailDto }>(`/api/orders/${encodeURIComponent(orderId)}`);
  if (q.loading) return <SkeletonRows />;
  const o = q.data?.order;
  if (!o || !o.actions.edit) {
    const msg = !o
      ? q.error?.status === 404
        ? "No accessible order has this ID. It may belong to another representative."
        : errorMessage(q.error)
      : o.financiallyLocked
        ? `${o.orderNumber} has been invoiced, so its amounts, rate and items are locked.`
        : `${o.orderNumber} is ${o.status.toLowerCase()} and can no longer be edited.`;
    return (
      <Blueprint className="flex max-w-[640px] flex-col gap-[10px] px-7 py-10">
        <h2 className="m-0">{o ? "This order can't be edited" : "Order not available"}</h2>
        <p className="m-0">{msg}</p>
        <Button className="self-start" icon="chevL" onClick={() => (o ? go.order(o.id) : go.to(ROUTES.orders))}>
          {o ? "Back to the order" : "All orders"}
        </Button>
      </Blueprint>
    );
  }
  const initial: Initial = {
    orderId: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    version: o.version,
    customer: { id: o.customer.id, label: `${o.customer.businessName} · ${o.customer.city}`, hint: `${o.customer.nipt} · ${o.customer.city}`, assignedRepId: null },
    repId: o.salesRep.id,
    repName: o.salesRep.name,
    date: o.orderDate,
    deliveryId: o.deliveryAddressId ?? "pickup",
    deliveryLabel: o.delivery?.pickup ? "Pickup at warehouse" : [o.delivery?.street, o.delivery?.city].filter(Boolean).join(", "),
    currency: o.currencyCode as CurrencyCode,
    lines: o.items.map((i) => ({
      key: lineKey++,
      itemId: i.id,
      product: { id: i.productId, name: i.name, sku: i.sku, unit: i.unit, defaultNetAll: i.catalogueNetAll ?? "0", vatRate: i.catalogueVatRate ?? i.vatRate },
      quantity: i.quantity,
      price: i.priceOverride ? i.unitNetPrice : null,
      discount: i.discountPercent,
    })),
  };
  return <OrderEditor key={o.version} initial={initial} />;
}

/* ---------------------------------------------------------------- editor */

type Errors = Record<string, string>;

function OrderEditor({ initial }: { initial: Initial }) {
  const role = useRole();
  const actions = useActions();
  const go = useGo();
  const editing = !!initial.orderId;

  const [customer, setCustomer] = useState<CustomerRef | null>(initial.customer);
  const [repChoice, setRepChoice] = useState<string | null>(initial.repId || null);
  const [date, setDate] = useState(initial.date);
  const [deliveryId, setDeliveryId] = useState(initial.deliveryId);
  const [currency, setCurrency] = useState<CurrencyCode>(initial.currency);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState("");
  const [saving, setSaving] = useState(false);

  // Server data: the customer's addresses, the reps (managers), the rate for the date.
  const detail = useApiQuery<{ customer: CustomerDetailDto }>(customer ? `/api/customers/${customer.id}` : null);
  const addresses = detail.data?.customer.addresses ?? [];
  const reps = useApiQuery<EmployeePage>(role.scopedToOwnCustomers ? null : "/api/employees?active=true&pageSize=100&sort=lastName");
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const rateQ = useApiQuery<ApplicableRateDto>(currency !== "ALL" && dateOk ? `/api/exchange-rates/applicable${qs({ currency, date })}` : null);
  const rate = currency === "ALL" ? "1" : (rateQ.data?.rate?.allPerUnit ?? null);
  const repId = repChoice ?? customer?.assignedRepId ?? "";
  const effectiveDelivery = deliveryId || (addresses.find((a) => a.isDefault) ?? addresses[0])?.id || (customer && detail.data ? "pickup" : "");

  /* -------- estimate (browser, provisional) -------- */
  const rows = lines.map((l) => {
    const catalogue = l.product && rate ? catalogueUnitPrice(l.product.defaultNetAll, rate) : null;
    const unitPrice = l.price ?? catalogue;
    const est = l.product && unitPrice ? estimateLine({ quantity: l.quantity, unitPrice, discountPercent: l.discount, vatRate: l.product.vatRate }) : null;
    return { line: l, catalogue, unitPrice, est };
  });
  const estimate: EstimateTotals = estimateTotals(rows.map((r) => r.est));
  const counted = rows.filter((r) => r.line.product);

  /* -------- request body (the server prices it) -------- */
  const sent = lines.filter((l) => l.product);
  const body = {
    customerId: customer?.id ?? "",
    salesRepId: role.scopedToOwnCustomers ? null : repId || null,
    orderDate: date,
    currencyCode: currency,
    deliveryAddressId: effectiveDelivery && effectiveDelivery !== "pickup" ? effectiveDelivery : null,
    lines: sent.map((l) => ({ id: l.itemId, productId: l.product!.id, quantity: l.quantity, unitNetPrice: l.price, discountPercent: l.discount || "0" })),
  };
  const bodyKey = JSON.stringify(body);
  const quote = useServerQuote(bodyKey, orderBodySchema.safeParse(body).success && !!effectiveDelivery, initial.orderId);
  const fresh = quote.key === bodyKey && quote.data ? quote.data : null;
  const quoteError = quote.key === bodyKey ? quote.error : null;
  const shown = fresh ? fresh.totals : estimate;
  const totalAll = currency === "ALL" ? null : fresh ? fresh.grandTotalAll : rate ? toAllEstimate(estimate.grandTotal, rate) : null;

  /* -------- edits -------- */
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const onEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLine();
    }
  };
  const lineError = (l: Line, field: string) => errors[`line:${l.key}:${field}`];

  /** Server/schema error paths ("lines.2.quantity") → the form line they belong to. */
  const mapErrors = (details: Record<string, string | string[]> | undefined): Errors => {
    const out: Errors = {};
    for (const [k, v] of Object.entries(details ?? {})) {
      const msg = Array.isArray(v) ? v[0] : v;
      const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
      if (m && sent[Number(m[1])]) out[`line:${sent[Number(m[1])].key}:${m[2]}`] = msg;
      else out[k] = msg;
    }
    return out;
  };

  const save = async (confirm: boolean) => {
    setBanner("");
    const parsed = orderBodySchema.safeParse(body);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const i of parsed.error.issues) details[i.path.join(".")] ??= i.message;
      setErrors(mapErrors(details));
      setBanner(!customer ? "Select a customer." : sent.length === 0 ? "Add at least one product line." : "Check the highlighted fields.");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      let order: OrderDetailDto;
      if (editing) {
        order = (await apiFetch<{ order: OrderDetailDto }>(`/api/orders/${initial.orderId}`, { method: "PATCH", body: { ...body, version: initial.version } })).order;
        if (confirm && order.status === "DRAFT") {
          order = (await apiFetch<{ order: OrderDetailDto }>(`/api/orders/${order.id}/confirm`, { method: "POST", body: { version: order.version } })).order;
        }
      } else {
        order = (await apiFetch<{ order: OrderDetailDto }>("/api/orders", { method: "POST", body: { ...body, status: confirm ? "CONFIRMED" : "DRAFT" } })).order;
      }
      refreshOrder(order.id, order.customer.id);
      actions.toast(`${order.orderNumber} ${editing ? "saved" : "created"} as ${order.status.toLowerCase()}. Total ${formatDecimal(order.totals.grandTotal, 2, 2)} ${order.currencyCode}, calculated by the server.`);
      go.order(order.id);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(mapErrors(e.details));
        setBanner(e.code === "VALIDATION_FAILED" ? "Check the highlighted fields." : errorMessage(e));
      } else setBanner(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => (editing ? go.order(initial.orderId!) : go.to(ROUTES.orders));

  const deliveryOptions = detail.data
    ? [
        ...addresses.map((a) => ({ value: a.id, label: `${a.label ?? ADDRESS_TYPE_LABEL[a.type]}: ${a.street}, ${a.city}` })),
        { value: "pickup", label: "Pickup at warehouse" },
      ]
    : customer && initial.deliveryLabel && customer.id === initial.customer?.id
      ? [{ value: initial.deliveryId, label: initial.deliveryLabel }]
      : [];

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${initial.orderNumber}` : "New order"}
        subtitle={
          editing
            ? `Status ${initial.status?.toLowerCase()}. Saving re-prices every line on the server.`
            : "Enter lines top to bottom. Press Enter in any line field to add the next line."
        }
        actions={
          <>
            <Button variant="ghost" onClick={discard} disabled={saving}>
              {editing ? "Cancel" : "Discard"}
            </Button>
            {editing ? (
              <>
                <Button variant={initial.status === "DRAFT" ? undefined : "primary"} onClick={() => save(false)} disabled={saving}>
                  Save changes
                </Button>
                {initial.status === "DRAFT" ? (
                  <Button variant="primary" icon="check" onClick={() => save(true)} disabled={saving}>
                    Save and confirm
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button onClick={() => save(false)} disabled={saving}>
                  Save as draft
                </Button>
                <Button variant="primary" icon="check" onClick={() => save(true)} disabled={saving}>
                  Confirm order
                </Button>
              </>
            )}
          </>
        }
      />
      {banner ? <AlertBanner>{banner}</AlertBanner> : null}

      <div className="grid items-start gap-5 xw:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel className="gap-[14px]">
            <h3 className="panel-title">Order information</h3>
            <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
              <Field label="Customer" htmlFor="no-cust" className="col-span-2 max-sm:col-span-full" hint={customer?.hint} error={errors.customerId}>
                <SearchSelect<CustomerRow>
                  id="no-cust"
                  ariaLabel="Customer"
                  placeholder="Search by name, NIPT or city…"
                  selectedLabel={customer?.label ?? ""}
                  url={(q) => "/api/customers" + qs({ q, status: "ACTIVE", pageSize: 8, sort: "businessName" })}
                  items={(d) => (d as CustomerPage).items}
                  itemKey={(c) => c.id}
                  render={(c) => (
                    <span className="flex flex-col">
                      <span className="font-medium">{c.businessName}</span>
                      <span className="text-[12px] text-neutral-700">
                        {c.nipt} · {c.city}
                        {c.assignedRep ? ` · ${c.assignedRep.name}` : ""}
                      </span>
                    </span>
                  )}
                  onPick={(c) => {
                    setCustomer(customerRef(c));
                    setRepChoice(null);
                    setDeliveryId("");
                  }}
                  invalid={!!errors.customerId}
                  describedBy={errors.customerId ? "no-cust-error" : undefined}
                />
              </Field>
              <Field label="Sales representative" htmlFor="no-rep" error={errors.salesRepId}>
                {role.scopedToOwnCustomers ? (
                  <input id="no-rep" className="input" readOnly value={initial.repName ?? role.user} title="Orders you create are attributed to you." />
                ) : (
                  <select id="no-rep" className="input" value={repId} onChange={(e) => setRepChoice(e.target.value)} {...invalidProps("no-rep", errors.salesRepId)}>
                    <option value="">Select…</option>
                    <SelectOptions options={(reps.data?.items ?? []).map((e) => ({ value: e.id, label: e.name }))} />
                    {initial.repName && !(reps.data?.items ?? []).some((e) => e.id === initial.repId) ? <option value={initial.repId}>{initial.repName}</option> : null}
                  </select>
                )}
              </Field>
              <Field label="Order date" htmlFor="no-date" error={errors.orderDate}>
                <input id="no-date" className="input" type="date" max={businessDate()} value={date} onChange={(e) => setDate(e.target.value)} {...invalidProps("no-date", errors.orderDate)} />
              </Field>
              <Field label="Delivery address" htmlFor="no-addr" className="col-span-2 max-sm:col-span-full" error={errors.deliveryAddressId}>
                <select id="no-addr" className="input" value={effectiveDelivery} disabled={!customer} onChange={(e) => setDeliveryId(e.target.value)} {...invalidProps("no-addr", errors.deliveryAddressId)}>
                  {customer ? <SelectOptions options={deliveryOptions} /> : <option value="">Select a customer first</option>}
                </select>
              </Field>
              <Field label="Currency" error={errors.currencyCode}>
                <Segmented
                  name="no-cur"
                  label="Currency"
                  options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
                  value={currency}
                  onChange={(v) => {
                    setCurrency(v as CurrencyCode);
                    // Entered prices were in the old currency: go back to catalogue prices.
                    setLines((ls) => ls.map((l) => ({ ...l, price: null })));
                  }}
                />
              </Field>
              <Field
                label={`Exchange rate (ALL per 1 ${currency})`}
                htmlFor="no-rate"
                hint={
                  currency === "ALL"
                    ? "ALL is the base currency."
                    : rateQ.data?.rate
                      ? `Entered in Settings, in effect since ${formatDate(rateQ.data.rate.effectiveAt?.slice(0, 10))}. Stored on the order when saved.`
                      : undefined
                }
              >
                <input id="no-rate" className="input tabular-nums" readOnly disabled={currency === "ALL"} value={currency === "ALL" ? "1" : rateQ.loading ? "Loading…" : (rate ?? "No rate")} />
              </Field>
            </div>
            {currency !== "ALL" && rateQ.data && !rateQ.data.rate ? <AlertBanner>{rateQ.data.message}</AlertBanner> : null}
          </Panel>

          <Panel className="gap-3">
            <div className="flex items-baseline justify-between">
              <h3 className="panel-title">Order items</h3>
              <span className="panel-note">
                Unit prices in {currency}, excluding VAT{role.canOverridePrices ? "" : " · catalogue prices"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="table min-w-[860px]">
                <thead>
                  <tr>
                    <th className="w-7">#</th>
                    <th>Product</th>
                    <th>SKU</th>
                    <th className="w-24 text-right">Qty</th>
                    <th className="w-[120px] text-right">Unit price</th>
                    <th className="w-[84px] text-right">Disc. %</th>
                    <th className="w-14 text-right">VAT</th>
                    <th className="w-[130px] text-right">Line total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ line: l, catalogue, unitPrice, est }, i) => {
                    const serverLine = fresh && l.product ? fresh.lines[sent.indexOf(l)] : undefined;
                    const overridden = l.price !== null && catalogue !== null && l.price !== "" && Number(l.price) !== Number(catalogue);
                    return (
                      <tr key={l.key} className="hover:bg-transparent">
                        <td className="text-neutral-700">{i + 1}</td>
                        <td className="min-w-[220px]">
                          <SearchSelect<ProductRow>
                            small
                            ariaLabel={`Product, line ${i + 1}`}
                            placeholder="Search product or SKU…"
                            selectedLabel={l.product ? `${l.product.name} · ${l.product.sku}` : ""}
                            url={(q) => "/api/products" + qs({ q, active: true, pageSize: 8 })}
                            items={(d) => (d as ProductPage).items}
                            itemKey={(x) => x.id}
                            render={(x) => (
                              <span className="flex items-baseline justify-between gap-3">
                                <span>
                                  {x.name} <span className="text-[12px] text-neutral-700">· {x.sku}</span>
                                </span>
                                <span className="text-[12px] whitespace-nowrap text-neutral-700 tabular-nums">{formatDecimal(x.defaultNetAll, 2, 4)} ALL</span>
                              </span>
                            )}
                            onPick={(x) =>
                              setLine(l.key, {
                                itemId: l.product?.id === x.id ? l.itemId : undefined,
                                product: { id: x.id, name: x.name, sku: x.sku, unit: x.unit, defaultNetAll: x.defaultNetAll, vatRate: x.vatRate },
                                price: null,
                                quantity: l.quantity || "1",
                              })
                            }
                            onKeyDown={onEnter}
                            invalid={!!lineError(l, "productId")}
                          />
                        </td>
                        <td className="text-[12.5px] whitespace-nowrap text-neutral-700">{l.product ? l.product.sku : "—"}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <input
                              className="input input-sm text-right tabular-nums"
                              aria-label={`Quantity, line ${i + 1}`}
                              inputMode="decimal"
                              value={l.quantity}
                              aria-invalid={!!lineError(l, "quantity") || undefined}
                              onKeyDown={onEnter}
                              onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                            />
                            <span className="w-[34px] text-[11px] text-neutral-700">{l.product ? l.product.unit : ""}</span>
                          </div>
                        </td>
                        <td>
                          <input
                            className="input input-sm text-right tabular-nums"
                            aria-label={`Unit price, line ${i + 1}`}
                            inputMode="decimal"
                            value={l.price ?? catalogue ?? ""}
                            readOnly={!role.canOverridePrices}
                            title={role.canOverridePrices ? (overridden ? `Catalogue price ${catalogue}` : "Catalogue price at the order rate; type to override") : "Only managers and admins can change prices."}
                            aria-invalid={!!lineError(l, "unitNetPrice") || undefined}
                            onKeyDown={onEnter}
                            onChange={(e) => setLine(l.key, { price: e.target.value })}
                          />
                          {overridden ? (
                            <button type="button" className="mt-[2px] cursor-pointer border-0 bg-transparent p-0 text-[11px] text-accent-800 underline" onClick={() => setLine(l.key, { price: null })}>
                              Use catalogue {catalogue}
                            </button>
                          ) : null}
                        </td>
                        <td>
                          <input
                            className="input input-sm text-right tabular-nums"
                            aria-label={`Discount percent, line ${i + 1}`}
                            inputMode="decimal"
                            value={l.discount}
                            aria-invalid={!!lineError(l, "discountPercent") || undefined}
                            onKeyDown={onEnter}
                            onChange={(e) => setLine(l.key, { discount: e.target.value })}
                          />
                        </td>
                        <td className="num">{l.product ? `${formatDecimal(serverLine?.vatRate ?? l.product.vatRate, 0, 2)}%` : "—"}</td>
                        <td className="num font-medium whitespace-nowrap">
                          {serverLine ? formatDecimal(serverLine.lineTotal, 2, 2) : est && unitPrice ? <span className="text-neutral-700">≈ {formatDecimal(estimateTotals([est]).grandTotal, 2, 2)}</span> : "—"}
                        </td>
                        <td>
                          {lines.length > 1 ? (
                            <Button
                              variant="ghost"
                              iconOnly
                              icon="trash"
                              aria-label={`Remove line ${i + 1}`}
                              className="h-[30px] w-[30px] text-neutral-700"
                              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <LineErrors lines={lines} errors={errors} />
            <Button icon="plus" className="self-start" onClick={addLine}>
              Add line
            </Button>
          </Panel>
        </div>

        <Panel className="sticky top-[76px] gap-[10px]">
          <div className="flex items-baseline justify-between">
            <h3 className="panel-title">Order summary</h3>
            <span className="panel-note">
              {counted.length} {counted.length === 1 ? "line" : "lines"}
            </span>
          </div>
          {fresh ? (
            <span className="tag self-start" style={{ background: "var(--color-success-100)", color: "var(--color-success-800)" }}>
              Confirmed by server
            </span>
          ) : (
            <span className="tag tag-outline self-start">{quote.pending ? "Estimate · checking with server…" : "Estimate"}</span>
          )}
          <div className="flex flex-col gap-[6px] text-[14px]">
            {(
              [
                ["Subtotal", shown.subtotalNet],
                ["Discounts", shown.discountTotal],
                ["Taxable amount", shown.taxableTotal],
                ["VAT", shown.vatTotal],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-neutral-700">{k}</span>
                <span className="tabular-nums">
                  {k === "Discounts" ? "−" : ""}
                  {formatDecimal(v, 2, 2)} {currency}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-divider pt-[10px]">
            <span className="font-heading text-[18px] font-semibold">Total</span>
            <span className="font-heading text-[24px] font-semibold tabular-nums">
              {formatDecimal(shown.grandTotal, 2, 2)} {currency}
            </span>
          </div>
          {currency !== "ALL" ? (
            <div className="text-right text-[12px] text-neutral-700 tabular-nums">
              {rate && totalAll ? `≈ ${formatDecimal(totalAll, 2, 2)} ALL at 1 ${currency} = ${rate} ALL` : "No exchange rate for this date"}
            </div>
          ) : null}
          {quoteError ? <p className="m-0 text-[12.5px] text-danger-800">{quoteError}</p> : null}
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-neutral-700">
            {fresh
              ? "These figures come from the server's pricing service: discounts before VAT, HALF_UP rounding per line. Saving recalculates them once more."
              : "Estimated in the browser while you type. The server recalculates every line, discount, VAT and rounding; only its totals are saved."}
          </p>
        </Panel>
      </div>
    </>
  );
}

function LineErrors({ lines, errors }: { lines: Line[]; errors: Errors }) {
  const items = lines.flatMap((l, i) =>
    (["productId", "quantity", "unitNetPrice", "discountPercent"] as const).flatMap((f) => (errors[`line:${l.key}:${f}`] ? [`Line ${i + 1}: ${errors[`line:${l.key}:${f}`]}`] : [])),
  );
  if (errors.lines) items.unshift(errors.lines);
  if (!items.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-danger-800" role="alert">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ quote */

interface QuoteState {
  key: string;
  data: OrderQuoteDto | null;
  error: string | null;
}

/**
 * Debounced POST /api/orders/quote for the current body: the server prices the
 * order without saving it, so the summary can show authoritative figures.
 */
function useServerQuote(bodyKey: string, ready: boolean, orderId?: string): QuoteState & { pending: boolean } {
  const debounced = useDebounced(ready ? bodyKey : "", 400);
  const [state, setState] = useState<QuoteState>({ key: "", data: null, error: null });
  useEffect(() => {
    if (!debounced) return;
    const ctrl = new AbortController();
    apiFetch<{ quote: OrderQuoteDto }>("/api/orders/quote", { method: "POST", body: { ...JSON.parse(debounced), orderId }, signal: ctrl.signal })
      .then((r) => setState({ key: debounced, data: r.quote, error: null }))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState({ key: debounced, data: null, error: e instanceof ApiError && e.status !== 401 ? e.message : errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [debounced, orderId]);
  return useMemo(() => ({ ...state, pending: ready && state.key !== bodyKey }), [state, ready, bodyKey]);
}
