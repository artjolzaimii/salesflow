"use client";

import { useMemo, useState } from "react";
import { salesReport, type ReportCurrency, type ReportGroup } from "@/lib/analytics";
import { usePreview } from "@/store/preview-store";
import { useScopedData } from "@/store/hooks";
import { Blueprint, Panel } from "@/components/ui/blueprint";
import { Field, Segmented } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";

const GROUPS: { value: ReportGroup; label: string }[] = [
  { value: "rep", label: "Representative" },
  { value: "customer", label: "Customer" },
  { value: "product", label: "Product" },
  { value: "currency", label: "Currency" },
  { value: "outstanding", label: "Outstanding" },
];

const BASES: { value: ReportCurrency; label: string }[] = [
  { value: "ALL_EQ", label: "All → ALL" },
  { value: "ALL", label: "ALL only" },
  { value: "EUR", label: "EUR only" },
  { value: "USD", label: "USD only" },
];

/** Sales report preview (GET /api/reports/sales?groupBy&from&to&currency in production). */
export function ReportsView() {
  const today = usePreview((s) => s.today);
  const allOrders = usePreview((s) => s.data.orders);
  const products = usePreview((s) => s.data.products);
  const { invoices, customerById, repName } = useScopedData();
  const [from, setFrom] = useState("2026-10-01");
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState<ReportGroup>("rep");
  const [currency, setCurrency] = useState<ReportCurrency>("ALL_EQ");

  const r = useMemo(
    () => salesReport({ invoices, allOrders, products, customerById, repName, from, to, group, currency, today }),
    [invoices, allOrders, products, customerById, repName, from, to, group, currency, today],
  );

  return (
    <>
      <PageHeader title="Reports" subtitle={r.basis} />
      <div className="flex flex-wrap items-end gap-x-5 gap-y-[14px]">
        <Field label="Issued from" htmlFor="rp-from">
          <input id="rp-from" className="input w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="to" htmlFor="rp-to">
          <input id="rp-to" className="input w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Group by">
          <Segmented name="rg" label="Group by" options={GROUPS} value={group} onChange={(v) => setGroup(v as ReportGroup)} />
        </Field>
        <Field label="Currency basis">
          <Segmented name="rc" label="Currency basis" options={BASES} value={currency} onChange={(v) => setCurrency(v as ReportCurrency)} />
        </Field>
      </div>

      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {r.summary.map((k) => (
          <Blueprint key={k.label} className="flex flex-col gap-1 px-4 py-[14px]">
            <span className="kicker">{k.label}</span>
            <span className="font-heading text-[24px] font-semibold tabular-nums">{k.value}</span>
          </Blueprint>
        ))}
      </div>

      <Panel className="gap-[10px] py-[14px]">
        <div className="flex items-baseline justify-between">
          <h3 className="panel-title">Breakdown</h3>
          <span className="panel-note">{r.invoiceCount} invoices in range</span>
        </div>
        {r.rows.length === 0 ? (
          <div className="text-muted py-8 text-center">No invoices in this range and currency.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  {r.columns.map((c) => (
                    <th key={c.title} style={{ textAlign: c.align }}>
                      {c.title}
                    </th>
                  ))}
                  {r.showShare ? <th className="w-[22%]">Share of net</th> : null}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.key}>
                    {row.cells.map((v, i) => (
                      <td key={i} className="tabular-nums" style={{ textAlign: r.columns[i].align }}>
                        {v}
                      </td>
                    ))}
                    {r.showShare ? (
                      <td>
                        <div className="h-[10px] bg-neutral-200">
                          <div className="h-full bg-accent" style={{ width: row.share + "%" }} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
