import { formatMoney, lineTotals } from "@/lib/money";
import type { Currency, Order, Product, Totals } from "@/lib/types";

/** Item table shared by the order and invoice drawers. */
export function ItemsTable({ order, products }: { order: Order | undefined; products: Product[] }) {
  const rows = (order?.items ?? []).map((it, i) => {
    const p = products.find((x) => x.id === it.productId);
    const vatRate = p?.vatRate ?? 0;
    return {
      key: i,
      name: p?.name ?? it.productId,
      sku: p?.sku ?? "",
      qty: `${it.quantity.toLocaleString("en-US")} ${p?.unit ?? ""}`,
      price: formatMoney(it.unitPrice),
      disc: `${it.discountPct}%`,
      vat: `${vatRate}%`,
      total: formatMoney(lineTotals(it, vatRate).total),
    };
  });
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
