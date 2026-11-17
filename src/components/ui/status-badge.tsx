import type { OrderStatus, PaymentStatus } from "@/lib/types";

export type BadgeLabel = OrderStatus | PaymentStatus | "Invoiced" | "Active" | "Inactive" | "Blocked";

const TONES: Record<BadgeLabel, { bg: string; fg: string }> = {
  Draft: { bg: "var(--color-neutral-200)", fg: "var(--color-neutral-800)" },
  Confirmed: { bg: "var(--color-accent-100)", fg: "var(--color-accent-800)" },
  Processing: { bg: "var(--color-accent-2-100)", fg: "var(--color-accent-2-800)" },
  Delivered: { bg: "var(--color-accent-200)", fg: "var(--color-accent-900)" },
  /** Derived financial indicator shown beside the operational status. */
  Invoiced: { bg: "var(--color-accent-200)", fg: "var(--color-accent-900)" },
  Cancelled: { bg: "transparent", fg: "var(--color-neutral-700)" },
  Paid: { bg: "var(--color-success-100)", fg: "var(--color-success-800)" },
  Partial: { bg: "var(--color-warning-100)", fg: "var(--color-warning-800)" },
  Unpaid: { bg: "var(--color-neutral-200)", fg: "var(--color-neutral-800)" },
  Overdue: { bg: "var(--color-danger-100)", fg: "var(--color-danger-800)" },
  Active: { bg: "var(--color-success-100)", fg: "var(--color-success-800)" },
  Inactive: { bg: "var(--color-neutral-200)", fg: "var(--color-neutral-700)" },
  Blocked: { bg: "var(--color-danger-100)", fg: "var(--color-danger-800)" },
};

/** Foreground tone for a status, reused by charts and legends. */
export function statusColor(label: BadgeLabel): string {
  return TONES[label].fg;
}

/**
 * Status tag. Order statuses carry a 1px border (visible only on Cancelled),
 * matching the prototype; payment and record statuses do not.
 */
export function StatusBadge({ label, bordered = false }: { label: BadgeLabel; bordered?: boolean }) {
  const tone = TONES[label] ?? TONES.Draft;
  return (
    <span
      className="tag"
      style={{
        background: tone.bg,
        color: tone.fg,
        border: bordered ? `1px solid ${label === "Cancelled" ? "var(--color-divider)" : "transparent"}` : undefined,
      }}
    >
      {label}
    </span>
  );
}
