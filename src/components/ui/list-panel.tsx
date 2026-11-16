"use client";

import type { ReactNode } from "react";
import type { ListState } from "@/store/hooks";
import { useActions } from "@/store/preview-store";
import { Panel } from "./blueprint";
import { ListEmpty, ListError, SkeletonRows } from "./states";

/**
 * Framed list section: filter row, then exactly one of loading skeleton,
 * error with retry, empty state, or the table (children).
 */
export function ListPanel<T>({
  state,
  filters,
  onClear,
  clearLabel,
  children,
}: {
  state: ListState<T>;
  filters?: ReactNode;
  onClear: () => void;
  clearLabel?: string;
  children: ReactNode;
}) {
  const actions = useActions();
  return (
    <Panel className="gap-3 pt-[14px] pb-[10px]">
      {filters}
      {state.loading ? <SkeletonRows /> : null}
      {state.error ? <ListError message={state.errorBody} onRetry={() => actions.toast(`Retry refetches ${state.endpoint}.`)} /> : null}
      {state.empty ? <ListEmpty title={state.emptyTitle} body={state.emptyBody} onClear={state.showClear ? onClear : undefined} clearLabel={clearLabel} /> : null}
      {state.show ? children : null}
    </Panel>
  );
}

export function FilterRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-[10px]">{children}</div>;
}

/** Per-currency footer totals; amounts in different currencies are never summed together. */
export function CurrencyTotals({ items }: { items: { cur: string; label: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-6 border-t border-divider pt-[6px] pb-1 text-[13px]">
      {items.map((t) => (
        <div key={t.cur} className="flex items-baseline gap-[10px] tabular-nums">
          <span className="font-semibold">{t.cur}</span>
          <span className="text-neutral-700">{t.label}</span>
          <span>{t.value}</span>
        </div>
      ))}
    </div>
  );
}
