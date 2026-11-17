import { z } from "zod";
import { ADDRESS_TYPES, BUSINESS_SIZES, BUSINESS_TYPES, CUSTOMER_STATUSES, NIPT_PATTERN, normalizeNipt } from "@/lib/labels";
import { optionalEmail, optionalPhone, optionalText, text } from "./common";

export const niptSchema = z
  .string()
  .transform(normalizeNipt)
  .refine((v) => NIPT_PATTERN.test(v), "NIPT is one letter, eight digits, one letter (e.g. L12345678A).");

export const contactSchema = z.object({
  fullName: text(150, "Contact name is required."),
  jobTitle: optionalText(100),
  email: optionalEmail,
  phone: optionalPhone,
  isPrimary: z.boolean().default(false),
});
export const contactPatchSchema = contactSchema.partial();

export const addressSchema = z.object({
  label: optionalText(100),
  type: z.enum(ADDRESS_TYPES).default("DELIVERY"),
  street: text(255, "Street address is required."),
  city: text(100, "City is required."),
  municipality: optionalText(100),
  postalCode: optionalText(20).refine((v) => v === null || /^\d{4}$/.test(v), "Albanian postal codes have four digits."),
  isDefault: z.boolean().default(false),
});
export const addressPatchSchema = addressSchema.partial();

const customerFields = {
  businessName: text(255, "Business name is required."),
  nipt: niptSchema,
  businessType: z.enum(BUSINESS_TYPES, "Select a business type."),
  businessSize: z.enum(BUSINESS_SIZES, "Select a business size.").nullish().transform((v) => v ?? null),
  email: optionalEmail,
  phone: optionalPhone,
  city: text(100, "City is required."),
  municipality: optionalText(100),
  status: z.enum(CUSTOMER_STATUSES).default("ACTIVE"),
  notes: optionalText(2000),
  assignedRepId: z.uuid("Select a sales representative.").nullish().transform((v) => v ?? null),
};

export const customerCreateSchema = z.object({
  ...customerFields,
  contacts: z.array(contactSchema).min(1, "Add at least one contact.").max(20),
  addresses: z.array(addressSchema).min(1, "Add at least one address.").max(20),
});
export type CustomerCreateInput = z.input<typeof customerCreateSchema>;

/** PATCH: any subset of the customer's own fields. Contacts and addresses have their own endpoints. */
export const customerPatchSchema = z
  .object({
    businessName: customerFields.businessName,
    nipt: customerFields.nipt,
    businessType: customerFields.businessType,
    businessSize: z.enum(BUSINESS_SIZES).nullable(),
    email: optionalEmail,
    phone: optionalPhone,
    city: customerFields.city,
    municipality: optionalText(100),
    status: z.enum(CUSTOMER_STATUSES),
    notes: optionalText(2000),
    assignedRepId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");
export type CustomerPatchInput = z.input<typeof customerPatchSchema>;
