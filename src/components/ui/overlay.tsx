"use client";

import type { ReactNode } from "react";
import { Corners } from "./blueprint";
import { Button } from "./button";

/** Centered modal: `.dialog-backdrop` + blueprint `.dialog`. */
export function Dialog({
  onClose,
  labelledBy,
  role = "dialog",
  width = 560,
  zIndex = 80,
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  role?: "dialog" | "alertdialog";
  width?: number;
  zIndex?: number;
  children: ReactNode;
}) {
  return (
    <>
      <div className="dialog-backdrop" style={{ zIndex }} onClick={onClose} />
      <div className="pointer-events-none fixed inset-0 grid place-items-center p-4" style={{ zIndex: zIndex + 1 }}>
        <div
          className="dialog blueprint pointer-events-auto max-h-[calc(100vh-32px)] overflow-y-auto bg-bg"
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          style={{ width: `min(${width}px, 100%)` }}
        >
          <Corners />
          {children}
        </div>
      </div>
    </>
  );
}

/** Right-hand detail drawer used for orders and invoices. */
export function Drawer({
  label,
  width,
  onClose,
  header,
  children,
}: {
  label: string;
  width: number;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-[color-mix(in_srgb,var(--color-scrim)_30%,transparent)]" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={label}
        className="fixed top-0 right-0 bottom-0 z-[71] flex flex-col overflow-y-auto border-l border-divider bg-bg shadow-[var(--shadow-lg)]"
        style={{ width: `min(${width}px, 100vw)` }}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-divider bg-bg px-5 py-4">
          {header}
          <Button variant="ghost" iconOnly icon="x" aria-label="Close" onClick={onClose} className="text-text" />
        </div>
        <div className="flex flex-col gap-5 px-5 py-[18px]">{children}</div>
      </aside>
    </>
  );
}

/** Two-column definition list used in drawers and the customer overview. */
export function KeyValues({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-[6px] text-[14px]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
