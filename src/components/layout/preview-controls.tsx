"use client";

import type { DataState } from "@/lib/types";
import { useActions, usePreview } from "@/store/preview-store";

const DATA_STATES: { value: DataState; label: string }[] = [
  { value: "ready", label: "Ready" },
  { value: "loading", label: "Loading" },
  { value: "empty", label: "Empty" },
  { value: "error", label: "Error" },
];

/**
 * Preview-only switch that replaces the design tool's Tweaks panel
 * (dataState). The role is no longer switchable here: it comes from the
 * signed-in session and the server enforces it.
 */
export function PreviewControls() {
  const dataState = usePreview((s) => s.dataState);
  const actions = useActions();

  return (
    <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-[6px]">
      <label htmlFor="pv-state">Data state</label>
      <select
        id="pv-state"
        className="input min-h-7 px-[6px] py-[2px] text-[12px]"
        value={dataState}
        onChange={(e) => actions.setDataState(e.target.value as DataState)}
      >
        {DATA_STATES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
