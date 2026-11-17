/**
 * Operational order lifecycle, shared by the UI and the server. The database
 * trigger `protect_invoiced_order()` enforces the same table, so a bypassed
 * service still cannot make an invalid transition.
 *
 * "Invoiced" is not a status: it is derived from the order having an ISSUED
 * invoice. An invoiced order can still move CONFIRMED → PROCESSING → DELIVERED;
 * its money, rate and items stay locked.
 */

export const ORDER_STATUSES = ["DRAFT", "CONFIRMED", "PROCESSING", "DELIVERED", "CANCELLED"] as const;
export type OrderStatusCode = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatusCode, readonly OrderStatusCode[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatusCode, to: OrderStatusCode): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Order statuses that may carry an invoice. */
export const INVOICEABLE_STATUSES: readonly OrderStatusCode[] = ["CONFIRMED", "PROCESSING", "DELIVERED"];
