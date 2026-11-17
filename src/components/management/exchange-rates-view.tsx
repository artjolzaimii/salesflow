"use client";

import { useState } from "react";
import { formatDecimal } from "@/lib/decimal-format";
import { FOREIGN_CURRENCIES } from "@/lib/labels";
import { fieldErrors } from "@/lib/schemas/common";
import { exchangeRateSchema } from "@/lib/schemas/catalog";
import { formatDate } from "@/lib/money";
import { apiFetch, ApiError, errorMessage, qs } from "@/services/client/http";
import { invalidate, useApiQuery } from "@/services/client/query";
import type { RatePage } from "@/services/client/types";
import { useActions } from "@/store/preview-store";
import { apiListState, useRole } from "@/store/hooks";
import { Blueprint, Panel } from "@/components/ui/blueprint";
import { Button } from "@/components/ui/button";
import { Field, invalidProps, Segmented } from "@/components/ui/field";
import { FilterRow, ListPanel } from "@/components/ui/list-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Pager } from "@/components/ui/pager";
import { AlertBanner } from "@/components/ui/states";

const PAGE_SIZE = 20;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Settings → exchange rates (GET/POST /api/exchange-rates). Rates are entered
 * by hand as "1 EUR/USD = X ALL" and only ever appended; orders and invoices
 * keep the rate they were created with.
 */
export function ExchangeRatesView() {
  const role = useRole();
  const [currency, setCurrency] = useState("all");
  const [page, setPage] = useState(0);
  const list = useApiQuery<RatePage>("/api/exchange-rates" + qs({ currency, page: page + 1, pageSize: PAGE_SIZE }));
  const state = apiListState(list, list.data?.items ?? [], "exchange rates", currency !== "all");

  return (
    <>
      <PageHeader title="Settings" subtitle="Exchange rates for new orders. 1 unit of foreign currency = X ALL; existing orders and invoices keep their own rate." />
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
        {(list.data?.current ?? []).map((c) => (
          <Blueprint key={c.currencyCode} className="flex flex-col gap-1 px-4 py-[14px]">
            <span className="kicker">{c.currencyCode === "ALL" ? "Base currency" : `Current ${c.currencyCode} rate`}</span>
            <span className="font-heading text-[26px] font-semibold tabular-nums">
              {c.rate ? `1 ${c.currencyCode} = ${formatDecimal(c.rate.allPerUnit, 2, 8)} ALL` : "Not set"}
            </span>
            <span className="text-[12px] text-neutral-700">
              {c.currencyCode === "ALL" ? "Always 1" : c.rate && "effectiveAt" in c.rate ? `Effective ${formatDate(String(c.rate.effectiveAt).slice(0, 10))}` : "Add a rate below"}
            </span>
          </Blueprint>
        ))}
      </div>
      {role.canManageRates ? <AddRate /> : null}
      <ListPanel
        state={state}
        onClear={() => setCurrency("all")}
        filters={
          <FilterRow>
            <h3 className="panel-title mr-auto">Rate history</h3>
            <select
              className="input w-auto"
              aria-label="Currency"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">EUR and USD</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </FilterRow>
        }
      >
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Currency</th>
                <th className="text-right">ALL per unit</th>
                <th>Effective from</th>
                <th>Entered</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.currencyCode}</td>
                  <td className="num">{formatDecimal(r.allPerUnit, 2, 8)}</td>
                  <td>{formatDate(r.effectiveAt.slice(0, 10))}</td>
                  <td className="text-neutral-700">{formatDate(r.createdAt.slice(0, 10))}</td>
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

function AddRate() {
  const actions = useActions();
  const [f, setF] = useState({ currencyCode: "EUR", allPerUnit: "", effectiveAt: today() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = exchangeRateSchema.safeParse(f);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setFormError("");
    setSaving(true);
    try {
      await apiFetch("/api/exchange-rates", { method: "POST", body: f });
      invalidate("/api/exchange-rates");
      actions.toast(`1 ${f.currencyCode} = ${f.allPerUnit} ALL from ${formatDate(f.effectiveAt)} saved.`);
      setF((x) => ({ ...x, allPerUnit: "" }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_RATE") setErrors({ effectiveAt: e.message });
      else if (e instanceof ApiError && e.details) setErrors(e.fieldMessages());
      else setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="gap-[14px]">
      <h3 className="panel-title">Add a rate</h3>
      {formError ? <AlertBanner>{formError}</AlertBanner> : null}
      <div className="flex flex-wrap items-start gap-[14px]">
        <Field label="Currency">
          <Segmented name="rate-cur" label="Currency" options={FOREIGN_CURRENCIES.map((c) => ({ value: c, label: c }))} value={f.currencyCode} onChange={(v) => setF({ ...f, currencyCode: v })} />
        </Field>
        <Field label={`ALL per 1 ${f.currencyCode}`} htmlFor="rate-val" error={errors.allPerUnit} hint="Manual entry, up to 8 decimals.">
          <input
            id="rate-val"
            className="input w-[180px] text-right tabular-nums"
            inputMode="decimal"
            placeholder="97.80"
            value={f.allPerUnit}
            onChange={(e) => setF({ ...f, allPerUnit: e.target.value })}
            {...invalidProps("rate-val", errors.allPerUnit)}
          />
        </Field>
        <Field label="Effective from" htmlFor="rate-date" error={errors.effectiveAt}>
          <input id="rate-date" className="input w-[180px]" type="date" value={f.effectiveAt} onChange={(e) => setF({ ...f, effectiveAt: e.target.value })} {...invalidProps("rate-date", errors.effectiveAt)} />
        </Field>
        <Button variant="primary" className="mt-[21px]" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save rate"}
        </Button>
      </div>
    </Panel>
  );
}
