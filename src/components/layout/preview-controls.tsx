"use client";

import { ROLE_OPTIONS } from "@/lib/roles";
import type { DataState, Role } from "@/lib/types";
import { useActions, usePreview } from "@/store/preview-store";

const DATA_STATES: { value: DataState; label: string }[] = [
  { value: "ready", label: "Ready" },
  { value: "loading", label: "Loading" },
  { value: "empty", label: "Empty" },
  { value: "error", label: "Error" },
];

/**
 * Preview-only switches that replace the design tool's Tweaks panel
 * (role and dataState). They change what the UI renders, never permissions:
 * in production the role comes from the session.
 */
export function PreviewControls() {
  const role = usePreview((s) => s.role);
  const dataState = usePreview((s) => s.dataState);
  const actions = useActions();

  return (
    <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-[6px]">
      <label htmlFor="pv-role">View as</label>
      <select
        id="pv-role"
        className="input min-h-7 px-[6px] py-[2px] text-[12px]"
        value={role}
        onChange={(e) => actions.setRole(e.target.value as Role)}
      >
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
