import { formatDecimal } from "@/lib/decimal-format";
import { formatMoney, lineTotals } from "@/lib/money";
import type { Currency, Order, Totals } from "@/lib/types";

/**
 * Item table shared by the order and invoice drawers. Renders the line
 * snapshots (name, SKU, unit, price, VAT as sold), so later product edits never
 * change a historical document.
 */
export function ItemsTable({ order }: { order: Order | undefined }) {
  const rows = (order?.items ?? []).map((it, i) => ({
    key: i,
    name: it.productName,
    sku: it.sku,
    qty: `${it.quantity.toLocaleString("en-US")} ${it.unit}`,
    price: formatMoney(it.unitPrice),
    disc: `${it.discountPct}%`,
    vat: `${it.vatRate}%`,
    total: formatMoney(lineTotals(it, it.vatRate).total),
  }));
  return (
    <div className="flex flex-col gap-[6px]">
      <h4 className="m-0 text-[16px]">Items</h4>
      <div className="overflow-x-auto">
        <table className="table text-[13px]">
          <thead>
            <tr>
              <th>Product</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">Disc.</th>
              <th className="text-right">VAT</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.name}
                  <div className="text-[11.5px] text-neutral-700">{r.sku}</div>
                </td>
                <td className="text-right whitespace-nowrap">{r.qty}</td>
                <td className="num">{r.price}</td>
                <td className="text-right">{r.disc}</td>
                <td className="text-right">{r.vat}</td>
                <td className="num">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Subtotal → total block with an ALL equivalent for foreign-currency documents. */
export function FinancialSummary({ totals, currency, rate }: { totals: Totals; currency: Currency; rate: number }) {
  const rows: [string, string][] = [
    ["Subtotal", formatMoney(totals.net, currency)],
    ["Discounts", "−" + formatMoney(totals.discount, currency)],
    ["Taxable amount", formatMoney(totals.taxable, currency)],
    ["VAT", formatMoney(totals.vat, currency)],
  ];
  return (
    <div className="ml-auto flex w-[min(300px,100%)] flex-col gap-[6px] text-[14px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span className="text-muted">{k}</span>
          <span className="tabular-nums">{v}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-divider pt-2 font-heading text-[19px] font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(totals.total, currency)}</span>
      </div>
      {currency !== "ALL" ? (
        <div className="text-right text-[12px] text-neutral-700">
          ≈ {formatMoney(Math.round(totals.total * rate), "ALL")} at 1 {currency} = {rate.toFixed(2)} ALL
        </div>
      ) : null}
    </div>
  );
}

/* ---------- database-backed documents (exact decimal strings from the API) ---------- */

interface ApiItem {
  id?: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  unitNetPrice: string;
  discountPercent: string;
  vatRate: string;
  lineTotal: string;
  priceOverride?: boolean | null;
}

/** Items from the order-item snapshots, formatted without floating point. */
export function SnapshotItemsTable({ items }: { items: ApiItem[] }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <h4 className="m-0 text-[16px]">Items</h4>
      <div className="overflow-x-auto">
        <table className="table text-[13px]">
          <thead>
            <tr>
              <th>Product</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">Disc.</th>
              <th className="text-right">VAT</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id ?? i}>
                <td>
                  {it.name}
                  <div className="text-[11.5px] text-neutral-700">
                    {it.sku}
                    {it.priceOverride ? " · price set manually" : ""}
                  </div>
                </td>
                <td className="text-right whitespace-nowrap">
                  {formatDecimal(it.quantity, 0, 3)} {it.unit}
                </td>
                <td className="num">{formatDecimal(it.unitNetPrice, 2, 4)}</td>
                <td className="text-right">{formatDecimal(it.discountPercent, 0, 2)}%</td>
                <td className="text-right">{formatDecimal(it.vatRate, 0, 2)}%</td>
                <td className="num">{formatDecimal(it.lineTotal, 2, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface DecimalTotals {
  subtotalNet: string;
  discountTotal: string;
  taxableTotal: string;
  vatTotal: string;
  grandTotal: string;
}

/** Subtotal → total block from server totals, with the ALL equivalent at the stored rate. */
export function DecimalSummary({ totals, currency, rateText, totalAll }: { totals: DecimalTotals; currency: string; rateText: string; totalAll: string | null }) {
  const m = (v: string) => `${formatDecimal(v, 2, 2)} ${currency}`;
  const rows: [string, string][] = [
    ["Subtotal", m(totals.subtotalNet)],
    ["Discounts", "−" + m(totals.discountTotal)],
    ["Taxable amount", m(totals.taxableTotal)],
    ["VAT", m(totals.vatTotal)],
  ];
  return (
    <div className="ml-auto flex w-[min(300px,100%)] flex-col gap-[6px] text-[14px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span className="text-muted">{k}</span>
          <span className="tabular-nums">{v}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-divider pt-2 font-heading text-[19px] font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{m(totals.grandTotal)}</span>
      </div>
      {currency !== "ALL" && totalAll ? (
        <div className="text-right text-[12px] text-neutral-700">
          ≈ {formatDecimal(totalAll, 2, 2)} ALL at 1 {currency} = {rateText} ALL
        </div>
      ) : null}
    </div>
  );
}
