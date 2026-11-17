"use client";

import { businessDate } from "@/lib/business-date";
import { PERIOD_LABEL, PERIODS, type PeriodPreset } from "@/lib/report-period";
import { Field, Segmented } from "@/components/ui/field";

export interface PeriodState {
  period: PeriodPreset;
  from: string;
  to: string;
}

export const DEFAULT_PERIOD: PeriodState = { period: "month", from: "", to: "" };

/** Query parameters for a period; a custom range is sent only once both dates are set and ordered. */
export function periodParams(p: PeriodState): Record<string, string> | null {
  if (p.period !== "custom") return { period: p.period };
  if (!p.from || !p.to || p.from > p.to) return null;
  return { period: "custom", from: p.from, to: p.to };
}

/** Today / This week / This month / This year / Custom, in the `.seg` style; custom shows two date fields. */
export function PeriodPicker({ value, onChange, idPrefix }: { value: PeriodState; onChange: (v: PeriodState) => void; idPrefix: string }) {
  const today = businessDate();
  const invalid = value.period === "custom" && !!value.from && !!value.to && value.from > value.to;
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-[10px]">
      <Field label="Period">
        <Segmented
          name={`${idPrefix}-period`}
          label="Period"
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
          value={value.period}
          onChange={(v) => onChange({ period: v as PeriodPreset, from: value.from || `${today.slice(0, 8)}01`, to: value.to || today })}
        />
      </Field>
      {value.period === "custom" ? (
        <>
          <Field label="From" htmlFor={`${idPrefix}-from`}>
            <input id={`${idPrefix}-from`} className="input w-auto" type="date" max={today} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </Field>
          <Field label="to" htmlFor={`${idPrefix}-to`} error={invalid ? "End date is before the start date." : undefined}>
            <input id={`${idPrefix}-to`} className="input w-auto" type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </Field>
        </>
      ) : null}
    </div>
  );
}
