import { formatMoney } from "@/lib/money";

/** Right-aligned table cell: amount followed by a muted currency code. */
export function MoneyCell({ amount, currency }: { amount: number; currency: string }) {
  return (
    <td className="num whitespace-nowrap">
      {formatMoney(amount)} <span className="cur-suffix">{currency}</span>
    </td>
  );
}
