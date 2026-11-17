import { z } from "zod";
import { USER_ROLES } from "@/lib/permissions";
import { email, optionalPhone, optionalText, text } from "./common";

export const employeeAccountSchema = z.object({
  email,
  role: z.enum(USER_ROLES),
  /** Initial password, set by an administrator; at least 12 characters. */
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});

export const employeeCreateSchema = z.object({
  firstName: text(100, "First name is required."),
  lastName: text(100, "Last name is required."),
  phone: optionalPhone,
  territory: optionalText(150),
  isActive: z.boolean().default(true),
  /** Optional login account created with the employee (requires users.manage). */
  account: employeeAccountSchema.optional(),
});

export const employeePatchSchema = z
  .object({
    firstName: text(100, "First name is required."),
    lastName: text(100, "Last name is required."),
    phone: optionalPhone,
    territory: optionalText(150),
    isActive: z.boolean(),
    /** Required when deactivating an employee who still has assigned customers. */
    reassignCustomersTo: z.uuid().optional(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const reassignSchema = z.object({
  toEmployeeId: z.uuid("Select the representative who takes over."),
  /** Omit to move every customer currently assigned. */
  customerIds: z.array(z.uuid()).max(500).optional(),
});
