"use client";

import { useMemo, type KeyboardEvent } from "react";
import { DEFAULT_RATES, WAREHOUSE_PICKUP } from "@/mocks/fixtures";
import { addTotals, formatMoney, inputToCents, lineTotals, ZERO_TOTALS } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { CURRENCIES, type Currency, type Product } from "@/lib/types";
import { lineChecks, validateOrderDraft, type DraftLine } from "@/lib/validation";
import { blankLine, useActions, usePreview } from "@/store/preview-store";
import { useScopedData } from "@/store/hooks";
import { Panel } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Field, Segmented, SelectOptions } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { AlertBanner } from "@/components/ui/states";
import { useGo } from "@/components/layout/use-go";

/** Default unit price for a product in the order currency, as an editable string. */
function priceFor(product: Product | undefined, currency: Currency, rate: string): string {
  if (!product) return "";
  const r = currency === "ALL" ? 1 : parseFloat(rate) || 0;
  return r ? (Math.round(product.price / r) / 100).toFixed(2) : "";
}

const draftLineTotals = (l: DraftLine, p: Product | undefined) =>
  lineTotals({ quantity: Number(l.quantity) || 0, unitPrice: inputToCents(l.price), discountPct: Number(l.discount) || 0 }, p ? p.vatRate : 0);

export function NewOrderForm() {
  const draft = usePreview((s) => s.orderDraft);
  const products = usePreview((s) => s.data.products);
  const { customers, customerById, employees } = useScopedData();
  const actions = useActions();
  const go = useGo();

  const product = (id: string) => products.find((p) => p.id === id);
  const customer = draft.customerId ? customerById[draft.customerId] : undefined;
  const cur = draft.currency;
  const rate = cur === "ALL" ? 1 : parseFloat(draft.rate) || 0;

  const { sum, count } = useMemo(() => {
    let total = ZERO_TOTALS;
    let n = 0;
    draft.lines.forEach((l) => {
      const p = products.find((x) => x.id === l.productId);
      if (!p) return;
      n++;
      total = addTotals(total, draftLineTotals(l, p));
    });
    return { sum: total, count: n };
  }, [draft.lines, products]);

  const setLine = (i: number, patch: Partial<DraftLine>) => actions.updateDraft((d) => ({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const addLine = () => actions.updateDraft((d) => ({ lines: [...d.lines, blankLine()] }));
  const onEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLine();
    }
  };

  const setCurrency = (c: Currency) =>
    actions.updateDraft((d) => {
      const r = DEFAULT_RATES[c];
      return { currency: c, rate: r, lines: d.lines.map((l) => (l.productId ? { ...l, price: priceFor(product(l.productId), c, r) } : l)) };
    });

  const save = (status: "Draft" | "Confirmed") => {
    const error = validateOrderDraft({ customerId: draft.customerId, currency: cur, rate: draft.rate, lines: draft.lines });
    if (error) return actions.updateDraft({ error });
    const order = actions.createOrder({
      customerId: draft.customerId,
      repId: draft.repId,
      date: draft.date,
      currency: cur,
      exchangeRate: rate,
      deliveryAddressId: draft.address === "customer" ? "customer" : "pickup",
      status,
      items: draft.lines
        .filter((l) => l.productId)
        .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), discountPct: Number(l.discount), unitPrice: inputToCents(l.price) })),
    });
    go.order(order.id);
  };

  const discard = () => {
    actions.resetDraft();
    go.to(ROUTES.orders);
  };

  return (
    <>
      <PageHeader
        title="New order"
        subtitle="Enter lines top to bottom. Press Enter in any line field to add the next line."
        actions={
          <>
            <Button variant="ghost" onClick={discard}>
              Discard
            </Button>
            <Button onClick={() => save("Draft")}>Save as draft</Button>
            <Button variant="primary" icon="check" onClick={() => save("Confirmed")}>
              Confirm order
            </Button>
          </>
        }
      />
      {draft.error ? <AlertBanner>{draft.error}</AlertBanner> : null}

      <div className="grid items-start gap-5 xw:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel className="gap-[14px]">
            <h3 className="panel-title">Order information</h3>
            <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
              <Field label="Customer" htmlFor="no-cust" className="col-span-2 max-sm:col-span-full" hint={customer ? `${customer.nipt} · ${customer.type} · ${customer.city}` : undefined}>
                <select
                  id="no-cust"
                  className="input"
                  value={draft.customerId}
                  onChange={(e) => {
                    const c = customerById[e.target.value];
                    actions.updateDraft((d) => ({ customerId: e.target.value, repId: c ? c.repId : d.repId, address: "customer" }));
                  }}
                >
                  <option value="">Select customer…</option>
                  <SelectOptions options={customers.filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name} · ${c.city}` }))} />
                </select>
              </Field>
              <Field label="Sales representative" htmlFor="no-rep">
                <select id="no-rep" className="input" value={draft.repId} onChange={(e) => actions.updateDraft({ repId: e.target.value })}>
                  <option value="">Select…</option>
                  <SelectOptions options={employees.map((e) => ({ value: e.id, label: e.name }))} />
                </select>
              </Field>
              <Field label="Order date" htmlFor="no-date">
                <input id="no-date" className="input" type="date" value={draft.date} onChange={(e) => actions.updateDraft({ date: e.target.value })} />
              </Field>
              <Field label="Delivery address" htmlFor="no-addr" className="col-span-2 max-sm:col-span-full">
                <select id="no-addr" className="input" value={draft.address} onChange={(e) => actions.updateDraft({ address: e.target.value as "customer" | "pickup" })}>
                  {customer ? (
                    <>
                      <option value="customer">
                        {customer.street}, {customer.city}
                      </option>
                      <option value="pickup">{WAREHOUSE_PICKUP}</option>
                    </>
                  ) : (
                    <option value="customer">Select a customer first</option>
                  )}
                </select>
              </Field>
              <Field label="Currency">
                <Segmented name="no-cur" label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value={cur} onChange={(v) => setCurrency(v as Currency)} />
              </Field>
              <Field label={`Exchange rate (ALL per 1 ${cur})`} htmlFor="no-rate">
                <input
                  id="no-rate"
                  className="input tabular-nums"
                  inputMode="decimal"
                  value={draft.rate}
                  disabled={cur === "ALL"}
                  onChange={(e) => actions.updateDraft({ rate: e.target.value })}
                />
              </Field>
            </div>
          </Panel>

          <Panel className="gap-3">
            <div className="flex items-baseline justify-between">
              <h3 className="panel-title">Order items</h3>
              <span className="panel-note">Unit prices in {cur}, excluding VAT</span>
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
                  {draft.lines.map((l, i) => {
                    const p = product(l.productId);
                    return (
                      <tr key={l.key} className="hover:bg-transparent">
                        <td className="text-neutral-700">{i + 1}</td>
                        <td>
                          <select
                            className="input input-sm"
                            aria-label="Product"
                            value={l.productId}
                            onKeyDown={onEnter}
                            onChange={(e) => setLine(i, { productId: e.target.value, price: priceFor(product(e.target.value), cur, draft.rate), quantity: l.quantity || "1" })}
                          >
                            <option value="">Select product…</option>
                            <SelectOptions options={products.filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.name} · ${x.sku}` }))} />
                          </select>
                        </td>
                        <td className="text-[12.5px] whitespace-nowrap text-neutral-700">{p ? p.sku : "—"}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <input
                              className="input input-sm text-right tabular-nums"
                              aria-label="Quantity"
                              inputMode="decimal"
                              value={l.quantity}
                              aria-invalid={lineChecks.quantityInvalid(l) || undefined}
                              onKeyDown={onEnter}
                              onChange={(e) => setLine(i, { quantity: e.target.value })}
                            />
                            <span className="w-[34px] text-[11px] text-neutral-700">{p ? p.unit : ""}</span>
                          </div>
                        </td>
                        <td>
                          <input
                            className="input input-sm text-right tabular-nums"
                            aria-label="Unit price"
                            inputMode="decimal"
                            value={l.price}
                            aria-invalid={lineChecks.priceInvalid(l) || undefined}
                            onKeyDown={onEnter}
                            onChange={(e) => setLine(i, { price: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="input input-sm text-right tabular-nums"
                            aria-label="Discount percent"
                            inputMode="decimal"
                            value={l.discount}
                            aria-invalid={lineChecks.discountInvalid(l) || undefined}
                            onKeyDown={onEnter}
                            onChange={(e) => setLine(i, { discount: e.target.value })}
                          />
                        </td>
                        <td className="num">{p ? `${p.vatRate}%` : "—"}</td>
                        <td className="num font-medium whitespace-nowrap">{p ? formatMoney(draftLineTotals(l, p).total) : "—"}</td>
                        <td>
                          {draft.lines.length > 1 ? (
                            <Button
                              variant="ghost"
                              iconOnly
                              icon="trash"
                              aria-label="Remove line"
                              className="h-[30px] w-[30px] text-neutral-700"
                              onClick={() => actions.updateDraft((d) => ({ lines: d.lines.filter((_, j) => j !== i) }))}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button icon="plus" className="self-start" onClick={addLine}>
              Add line
            </Button>
          </Panel>
        </div>

        <Panel className="sticky top-[76px] gap-[10px]">
          <div className="flex items-baseline justify-between">
            <h3 className="panel-title">Order summary</h3>
            <span className="panel-note">
              {count} {count === 1 ? "line" : "lines"}
            </span>
          </div>
          <span className="tag tag-outline self-start">Preview calculation</span>
          <div className="flex flex-col gap-[6px] text-[14px]">
            {(
              [
                ["Subtotal", formatMoney(sum.net, cur)],
                ["Discounts", "−" + formatMoney(sum.discount, cur)],
                ["Taxable amount", formatMoney(sum.taxable, cur)],
                ["VAT", formatMoney(sum.vat, cur)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-neutral-700">{k}</span>
                <span className="tabular-nums">{v}</span>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-divider pt-[10px]">
            <span className="font-heading text-[18px] font-semibold">Total</span>
            <span className="font-heading text-[24px] font-semibold tabular-nums">{formatMoney(sum.total, cur)}</span>
          </div>
          {cur !== "ALL" ? (
            <div className="text-right text-[12px] text-neutral-700 tabular-nums">
              {rate ? `≈ ${formatMoney(Math.round(sum.total * rate), "ALL")} at the entered rate` : ""}
            </div>
          ) : null}
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-neutral-700">
            Computed in integer cents per line for guidance. The server recalculates discounts, VAT and rounding on save; its totals are authoritative.
          </p>
        </Panel>
      </div>
    </>
  );
}
