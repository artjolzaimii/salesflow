/**
 * Database enum values ↔ the labels the designed screens use. Shared by the
 * API clients and the forms so the two never drift apart.
 */
export const BUSINESS_TYPES = ["SUPERMARKET", "GROCERY", "RESTAURANT", "HOTEL", "CAFE", "WHOLESALER", "OTHER"] as const;
export type BusinessTypeCode = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_TYPE_LABEL: Record<BusinessTypeCode, string> = {
  SUPERMARKET: "Supermarket",
  GROCERY: "Grocery",
  RESTAURANT: "Restaurant",
  HOTEL: "Hotel",
  CAFE: "Café",
  WHOLESALER: "Wholesale",
  OTHER: "Other",
};

export const BUSINESS_SIZES = ["SMALL", "MEDIUM", "LARGE"] as const;
export type BusinessSizeCode = (typeof BUSINESS_SIZES)[number];
export const BUSINESS_SIZE_LABEL: Record<BusinessSizeCode, string> = { SMALL: "Small", MEDIUM: "Medium", LARGE: "Large" };

export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "BLOCKED"] as const;
export type CustomerStatusCode = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_STATUS_LABEL: Record<CustomerStatusCode, "Active" | "Inactive" | "Blocked"> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  BLOCKED: "Blocked",
};

export const ADDRESS_TYPES = ["DELIVERY", "BILLING", "BOTH", "REGISTERED_OFFICE"] as const;
export type AddressTypeCode = (typeof ADDRESS_TYPES)[number];
export const ADDRESS_TYPE_LABEL: Record<AddressTypeCode, string> = {
  DELIVERY: "Delivery",
  BILLING: "Billing",
  BOTH: "Billing & delivery",
  REGISTERED_OFFICE: "Registered office",
};

export const CURRENCY_CODES = ["ALL", "EUR", "USD"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export const FOREIGN_CURRENCIES = ["EUR", "USD"] as const;

export const VAT_RATES = ["20", "10", "6", "0"] as const;

export const CITIES = ["Berat", "Durrës", "Elbasan", "Fier", "Korçë", "Pogradec", "Sarandë", "Shkodër", "Tiranë", "Vlorë"] as const;

export const option = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

/** Albanian NIPT/NUIS: one letter, eight digits, one letter (e.g. L12345678A). */
export const NIPT_PATTERN = /^[A-Z]\d{8}[A-Z]$/;
export const normalizeNipt = (v: string) => v.replace(/\s+/g, "").toUpperCase();

/** Payment terms in days derived from business size (not stored; see docs/database.md). */
export function paymentTermsDays(size: BusinessSizeCode | null): number | null {
  return size === null ? null : size === "SMALL" ? 15 : 30;
}

export const ORDER_STATUS_LABEL = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
} as const;

export const PAYMENT_METHOD_LABEL = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", CARD: "Card", OTHER: "Other" } as const;
