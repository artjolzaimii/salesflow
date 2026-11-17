import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { BUSINESS_SIZES, BUSINESS_TYPES, CUSTOMER_STATUSES } from "@/lib/labels";
import { addressPatchSchema, addressSchema, contactPatchSchema, contactSchema, customerCreateSchema, customerPatchSchema } from "@/lib/schemas/customers";
import { assertPermission, hasPermission, isScoped, type Principal } from "@/server/auth/principal";
import { customerScope, orderScope } from "@/server/auth/scope";
import { getDb } from "@/server/db";
import { businessDate, ymd } from "@/lib/business-date";
import { INVOICE_PAYMENT_STATUS_LABEL } from "@/lib/invoice-status";
import { deriveInvoiceStatus } from "@/server/domain/invoice-status";
import { D } from "@/server/domain/money";
import { conflict, forbidden, invalid, mapDatabaseError, notFound } from "@/server/errors";
import { listQuery, paged, skipTake } from "@/server/query";

/* ---------------------------------------------------------------- list */

export const customerListQuery = listQuery(["businessName", "nipt", "city", "registeredAt", "status"] as const, "businessName").extend({
  status: z.enum(CUSTOMER_STATUSES).optional(),
  businessType: z.enum(BUSINESS_TYPES).optional(),
  businessSize: z.enum(BUSINESS_SIZES).optional(),
  city: z.string().trim().max(100).optional(),
  repId: z.uuid().optional(),
});
export type CustomerListQuery = z.output<typeof customerListQuery>;

const LIST_SELECT = {
  id: true,
  businessName: true,
  nipt: true,
  city: true,
  businessType: true,
  businessSize: true,
  status: true,
  registeredAt: true,
  assignedRep: { select: { id: true, firstName: true, lastName: true } },
  contacts: { where: { isPrimary: true }, take: 1, select: { fullName: true, phone: true } },
} satisfies Prisma.CustomerSelect;

/** Customers visible to the caller (representatives: assigned customers only). */
export async function listCustomers(p: Principal, query: CustomerListQuery = customerListQuery.parse({})) {
  assertPermission(p, "customers.view");
  const where: Prisma.CustomerWhereInput = {
    AND: [
      customerScope(p),
      query.status ? { status: query.status } : {},
      query.businessType ? { businessType: query.businessType } : {},
      query.businessSize ? { businessSize: query.businessSize } : {},
      query.city ? { city: { equals: query.city, mode: "insensitive" } } : {},
      query.repId ? { assignedRepId: query.repId } : {},
      query.q
        ? {
            OR: [
              { businessName: { contains: query.q, mode: "insensitive" } },
              { nipt: { contains: query.q.replace(/\s+/g, ""), mode: "insensitive" } },
              { city: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.customer.findMany({ where, select: LIST_SELECT, orderBy: [{ [query.sort]: query.dir }, { id: "asc" }], ...skipTake(query.page, query.pageSize) }),
    db.customer.count({ where }),
  ]);
  return paged(
    rows.map(({ assignedRep, contacts, ...c }) => ({ ...c, assignedRep: repRef(assignedRep), primaryContact: contacts[0] ?? null })),
    total,
    query.page,
    query.pageSize,
  );
}

const repRef = (e: { id: string; firstName: string; lastName: string } | null) => (e ? { id: e.id, name: `${e.firstName} ${e.lastName}` } : null);

/* -------------------------------------------------------------- detail */

/**
 * Customer with contacts, addresses and a read-only history of the orders,
 * invoices and payments that reference it (latest 50 each). History is never
 * edited here; reassigning the customer does not change who sold past orders.
 */
export async function getCustomer(p: Principal, id: string) {
  assertPermission(p, "customers.view");
  const db = getDb();
  const c = await db.customer.findFirst({
    where: { AND: [{ id }, customerScope(p)] },
    include: {
      assignedRep: { select: { id: true, firstName: true, lastName: true } },
      contacts: { omit: { customerId: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      addresses: { omit: { customerId: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { _count: { select: { orders: true } } } },
    },
  });
  if (!c) throw notFound("Customer");

  const orderWhere: Prisma.OrderWhereInput = { AND: [{ customerId: c.id }, orderScope(p)] };
  const [orders, invoices, payments, orderCount] = await Promise.all([
    db.order.findMany({
      where: orderWhere,
      orderBy: { orderDate: "desc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        currencyCode: true,
        grandTotal: true,
        salesRep: { select: { id: true, firstName: true, lastName: true } },
        invoices: { where: { status: "ISSUED" }, select: { invoiceNumber: true } },
      },
    }),
    db.invoice.findMany({
      where: { order: orderWhere },
      orderBy: { issueDate: "desc" },
      select: { id: true, invoiceNumber: true, issueDate: true, dueDate: true, status: true, currencyCode: true, total: true, payments: { select: { amount: true } } },
    }),
    db.payment.findMany({
      where: { invoice: { order: orderWhere } },
      orderBy: { paymentDate: "desc" },
      take: 50,
      select: { id: true, paymentDate: true, amount: true, currencyCode: true, method: true, reference: true, invoice: { select: { id: true, invoiceNumber: true } } },
    }),
    db.order.count({ where: orderWhere }),
  ]);

  const today = businessDate();
  const invoiceRows = invoices.map((i) => {
    const b = deriveInvoiceStatus(i, i.payments.reduce((s, x) => s.plus(x.amount), D(0)), today);
    return {
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: ymd(i.issueDate),
      dueDate: ymd(i.dueDate),
      currencyCode: i.currencyCode,
      total: i.total.toFixed(2),
      paid: b.paid.toFixed(2),
      outstanding: b.outstanding.toFixed(2),
      paymentStatus: b.paymentStatus,
      overdue: b.overdue,
      status: i.status === "CANCELLED" ? "Cancelled" : b.overdue ? "Overdue" : INVOICE_PAYMENT_STATUS_LABEL[b.paymentStatus],
    };
  });
  const summary = ["ALL", "EUR", "USD"]
    .map((cur) => {
      const rows = invoiceRows.filter((r) => r.currencyCode === cur && r.status !== "Cancelled");
      if (!rows.length) return null;
      const sum = (k: "total" | "paid" | "outstanding") => rows.reduce((s, r) => s.plus(r[k]), D(0)).toFixed(2);
      return { currencyCode: cur, invoiced: sum("total"), paid: sum("paid"), outstanding: sum("outstanding"), overdue: rows.filter((r) => r.status === "Overdue").length };
    })
    .filter((x) => x !== null);

  return {
    id: c.id,
    businessName: c.businessName,
    nipt: c.nipt,
    businessType: c.businessType,
    businessSize: c.businessSize,
    email: c.email,
    phone: c.phone,
    city: c.city,
    municipality: c.municipality,
    status: c.status,
    notes: c.notes,
    registeredAt: c.registeredAt,
    updatedAt: c.updatedAt,
    assignedRep: repRef(c.assignedRep),
    contacts: c.contacts,
    addresses: c.addresses.map(({ _count, ...a }) => ({ ...a, usedByOrders: _count.orders })),
    history: {
      orderCount,
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        orderDate: o.orderDate.toISOString().slice(0, 10),
        status: o.status,
        invoiced: o.invoices.length > 0,
        currencyCode: o.currencyCode,
        grandTotal: o.grandTotal.toFixed(2),
        salesRep: repRef(o.salesRep),
      })),
      invoices: invoiceRows.slice(0, 50),
      payments: payments.map((x) => ({
        id: x.id,
        paymentDate: x.paymentDate.toISOString().slice(0, 10),
        amount: x.amount.toFixed(2),
        currencyCode: x.currencyCode,
        method: x.method,
        reference: x.reference,
        invoiceId: x.invoice.id,
        invoiceNumber: x.invoice.invoiceNumber,
      })),
      financialSummary: summary,
    },
  };
}

/* ------------------------------------------------------------- helpers */

async function findScoped(p: Principal, id: string) {
  const c = await getDb().customer.findFirst({ where: { AND: [{ id }, customerScope(p)] }, select: { id: true, status: true, assignedRepId: true } });
  if (!c) throw notFound("Customer");
  return c;
}

async function assertAssignableEmployee(employeeId: string) {
  const e = await getDb().employee.findUnique({ where: { id: employeeId }, select: { isActive: true } });
  if (!e || !e.isActive) throw invalid("The selected representative does not exist or is inactive.", { assignedRepId: "Select an active representative." });
}

/** Exactly one flagged item: the first one is used when none is flagged. */
function oneFlagged<T>(items: T[], flag: keyof T, what: string): T[] {
  const flagged = items.filter((i) => i[flag]).length;
  if (flagged > 1) throw invalid(`Only one ${what} can be marked.`);
  return items.map((i, n) => ({ ...i, [flag]: flagged ? i[flag] : n === 0 }));
}

/* -------------------------------------------------------------- create */

/**
 * Registers a customer with its contacts and addresses in one statement
 * (Prisma nested create is atomic). Representatives always register customers
 * to themselves; only managers and admins choose another rep or BLOCKED status.
 * A duplicate NIPT is a 409 from the unique index.
 */
export async function createCustomer(p: Principal, raw: unknown) {
  assertPermission(p, "customers.create");
  const input = customerCreateSchema.parse(raw);

  let repId = input.assignedRepId;
  if (isScoped(p)) {
    if (!p.employeeId) throw forbidden("Your account has no employee record; ask an administrator.");
    if (repId && repId !== p.employeeId) throw forbidden("Representatives register customers to themselves.");
    repId = p.employeeId;
  } else if (repId) {
    await assertAssignableEmployee(repId);
  }
  if (input.status === "BLOCKED" && !hasPermission(p, "customers.assign")) throw forbidden("Only managers can block a customer.");

  try {
    const created = await getDb().customer.create({
      data: {
        businessName: input.businessName,
        nipt: input.nipt,
        businessType: input.businessType,
        businessSize: input.businessSize,
        email: input.email,
        phone: input.phone,
        city: input.city,
        municipality: input.municipality,
        status: input.status,
        notes: input.notes,
        assignedRepId: repId,
        contacts: { create: oneFlagged(input.contacts, "isPrimary", "primary contact") },
        addresses: { create: oneFlagged(input.addresses, "isDefault", "default address") },
      },
      select: { id: true },
    });
    return getCustomer(p, created.id);
  } catch (e) {
    throw mapDatabaseError(e);
  }
}

/* -------------------------------------------------------------- update */

export async function updateCustomer(p: Principal, id: string, raw: unknown) {
  assertPermission(p, "customers.update");
  const input = customerPatchSchema.parse(raw);
  const current = await findScoped(p, id);

  if (input.assignedRepId !== undefined && input.assignedRepId !== current.assignedRepId) {
    if (!hasPermission(p, "customers.assign")) throw forbidden("Only managers can reassign customers.");
    if (input.assignedRepId) await assertAssignableEmployee(input.assignedRepId);
  }
  const blockingChange = input.status !== undefined && input.status !== current.status && (input.status === "BLOCKED" || current.status === "BLOCKED");
  if (blockingChange && !hasPermission(p, "customers.assign")) throw forbidden("Only managers can block or unblock a customer.");

  try {
    await getDb().customer.update({ where: { id: current.id }, data: input });
  } catch (e) {
    throw mapDatabaseError(e);
  }
  return getCustomer(p, id);
}

/* ------------------------------------------------------------ contacts */

export async function addContact(p: Principal, customerId: string, raw: unknown) {
  assertPermission(p, "customers.update");
  const input = contactSchema.parse(raw);
  const c = await findScoped(p, customerId);
  const db = getDb();
  return db.$transaction(async (tx) => {
    const count = await tx.customerContact.count({ where: { customerId: c.id } });
    if (count >= 20) throw conflict("LIMIT_REACHED", "A customer can have at most 20 contacts.");
    const primary = input.isPrimary || count === 0;
    if (primary) await tx.customerContact.updateMany({ where: { customerId: c.id }, data: { isPrimary: false } });
    return tx.customerContact.create({ data: { ...input, isPrimary: primary, customerId: c.id } });
  });
}

export async function updateContact(p: Principal, customerId: string, contactId: string, raw: unknown) {
  assertPermission(p, "customers.update");
  const input = contactPatchSchema.parse(raw);
  const c = await findScoped(p, customerId);
  const db = getDb();
  return db.$transaction(async (tx) => {
    const contact = await tx.customerContact.findFirst({ where: { id: contactId, customerId: c.id } });
    if (!contact) throw notFound("Contact");
    if (input.isPrimary === false && contact.isPrimary) throw invalid("Make another contact primary instead.");
    if (input.isPrimary) await tx.customerContact.updateMany({ where: { customerId: c.id, id: { not: contact.id } }, data: { isPrimary: false } });
    return tx.customerContact.update({ where: { id: contact.id }, data: input });
  });
}

export async function deleteContact(p: Principal, customerId: string, contactId: string) {
  assertPermission(p, "customers.update");
  const c = await findScoped(p, customerId);
  const db = getDb();
  await db.$transaction(async (tx) => {
    const contact = await tx.customerContact.findFirst({ where: { id: contactId, customerId: c.id } });
    if (!contact) throw notFound("Contact");
    if (contact.isPrimary) throw conflict("PRIMARY_CONTACT", "Make another contact primary before removing this one.");
    await tx.customerContact.delete({ where: { id: contact.id } });
  });
  return { id: contactId, deleted: true };
}

/* ----------------------------------------------------------- addresses */

export async function addAddress(p: Principal, customerId: string, raw: unknown) {
  assertPermission(p, "customers.update");
  const input = addressSchema.parse(raw);
  const c = await findScoped(p, customerId);
  const db = getDb();
  return db.$transaction(async (tx) => {
    const count = await tx.customerAddress.count({ where: { customerId: c.id } });
    if (count >= 20) throw conflict("LIMIT_REACHED", "A customer can have at most 20 addresses.");
    const isDefault = input.isDefault || count === 0;
    if (isDefault) await tx.customerAddress.updateMany({ where: { customerId: c.id }, data: { isDefault: false } });
    return tx.customerAddress.create({ data: { ...input, isDefault, customerId: c.id } });
  });
}

/**
 * Editing an address never rewrites history: orders keep their own
 * deliverySnapshot of the address as it was when they were placed.
 */
export async function updateAddress(p: Principal, customerId: string, addressId: string, raw: unknown) {
  assertPermission(p, "customers.update");
  const input = addressPatchSchema.parse(raw);
  const c = await findScoped(p, customerId);
  const db = getDb();
  return db.$transaction(async (tx) => {
    const address = await tx.customerAddress.findFirst({ where: { id: addressId, customerId: c.id } });
    if (!address) throw notFound("Address");
    if (input.isDefault === false && address.isDefault) throw invalid("Make another address the default instead.");
    if (input.isDefault) await tx.customerAddress.updateMany({ where: { customerId: c.id, id: { not: address.id } }, data: { isDefault: false } });
    return tx.customerAddress.update({ where: { id: address.id }, data: input });
  });
}

export async function deleteAddress(p: Principal, customerId: string, addressId: string) {
  assertPermission(p, "customers.update");
  const c = await findScoped(p, customerId);
  const db = getDb();
  try {
    await db.$transaction(async (tx) => {
      const address = await tx.customerAddress.findFirst({ where: { id: addressId, customerId: c.id }, include: { _count: { select: { orders: true } } } });
      if (!address) throw notFound("Address");
      if (address.isDefault) throw conflict("DEFAULT_ADDRESS", "Make another address the default before removing this one.");
      if (address._count.orders) throw conflict("ADDRESS_IN_USE", "Orders were delivered to this address; it is kept for history.");
      await tx.customerAddress.delete({ where: { id: address.id } });
    });
  } catch (e) {
    throw mapDatabaseError(e);
  }
  return { id: addressId, deleted: true };
}
