import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { categoryPatchSchema, categorySchema, productPatchSchema, productSchema } from "@/lib/schemas/catalog";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { getDb } from "@/server/db";
import { conflict, invalid, mapDatabaseError, notFound } from "@/server/errors";
import { boolParam, listQuery, paged, skipTake } from "@/server/query";

/* ------------------------------------------------------------- products */

export const productListQuery = listQuery(["name", "sku", "defaultNetAll", "createdAt", "updatedAt"] as const, "name").extend({
  categoryId: z.uuid().optional(),
  active: boolParam.optional(),
});
export type ProductListQuery = z.output<typeof productListQuery>;

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  defaultNetAll: true,
  vatRate: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

/** Decimals leave the API as exact strings: price to 4 dp (numeric(18,4)), VAT as entered. */
const toProduct = (r: ProductRow) => ({ ...r, defaultNetAll: r.defaultNetAll.toFixed(4), vatRate: r.vatRate.toFixed(0) });

export async function listProducts(p: Principal, query: ProductListQuery = productListQuery.parse({})) {
  assertPermission(p, "products.view");
  const where: Prisma.ProductWhereInput = {
    AND: [
      query.categoryId ? { categoryId: query.categoryId } : {},
      query.active === undefined ? {} : { isActive: query.active },
      query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { sku: { contains: query.q, mode: "insensitive" } }] } : {},
    ],
  };
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.product.findMany({ where, select: PRODUCT_SELECT, orderBy: [{ [query.sort]: query.dir }, { id: "asc" }], ...skipTake(query.page, query.pageSize) }),
    db.product.count({ where }),
  ]);
  return paged(rows.map(toProduct), total, query.page, query.pageSize);
}

export async function getProduct(p: Principal, id: string) {
  assertPermission(p, "products.view");
  const db = getDb();
  const row = await db.product.findUnique({ where: { id }, select: PRODUCT_SELECT });
  if (!row) throw notFound("Product");
  const usedByOrderLines = await db.orderItem.count({ where: { productId: id } });
  return { ...toProduct(row), usedByOrderLines };
}

async function assertCategory(id: string) {
  if (!(await getDb().category.findUnique({ where: { id }, select: { id: true } }))) {
    throw invalid("The selected category does not exist.", { categoryId: "Select a category." });
  }
}

export async function createProduct(p: Principal, raw: unknown) {
  assertPermission(p, "products.manage");
  const input = productSchema.parse(raw);
  await assertCategory(input.categoryId);
  try {
    const row = await getDb().product.create({ data: input, select: { id: true } });
    return getProduct(p, row.id);
  } catch (e) {
    throw mapDatabaseError(e);
  }
}

/**
 * Edits the catalogue only. Order items keep their own snapshot of name, SKU,
 * unit, price and VAT, so historical orders and invoices never change.
 * Products are deactivated rather than deleted (order lines reference them).
 */
export async function updateProduct(p: Principal, id: string, raw: unknown) {
  assertPermission(p, "products.manage");
  const input = productPatchSchema.parse(raw);
  const db = getDb();
  if (!(await db.product.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Product");
  if (input.categoryId) await assertCategory(input.categoryId);
  try {
    await db.product.update({ where: { id }, data: input });
  } catch (e) {
    throw mapDatabaseError(e);
  }
  return getProduct(p, id);
}

/* ----------------------------------------------------------- categories */

/** All categories (small table) with product counts and the units in use. */
export async function listCategories(p: Principal) {
  assertPermission(p, "products.view");
  const db = getDb();
  const [cats, products] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, parentId: true, createdAt: true, _count: { select: { children: true } } } }),
    db.product.findMany({ select: { categoryId: true, unit: true, isActive: true } }),
  ]);
  return {
    items: cats.map(({ _count, ...c }) => {
      const mine = products.filter((x) => x.categoryId === c.id);
      return {
        ...c,
        parentName: cats.find((x) => x.id === c.parentId)?.name ?? null,
        childCount: _count.children,
        productCount: mine.length,
        activeProductCount: mine.filter((x) => x.isActive).length,
        units: [...new Set(mine.map((x) => x.unit))].sort(),
      };
    }),
  };
}

async function assertParent(parentId: string | null, selfId?: string) {
  if (!parentId) return;
  const db = getDb();
  if (parentId === selfId) throw invalid("A category cannot be its own parent.");
  // Walk up from the new parent; reaching the category itself would create a cycle.
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 50; depth++) {
    const node: { id: string; parentId: string | null } | null = await db.category.findUnique({ where: { id: cursor }, select: { id: true, parentId: true } });
    if (!node) throw invalid("The selected parent category does not exist.");
    if (selfId && node.parentId === selfId) throw invalid("That would put the category inside itself.");
    cursor = node.parentId;
  }
}

export async function createCategory(p: Principal, raw: unknown) {
  assertPermission(p, "categories.manage");
  const input = categorySchema.parse(raw);
  await assertParent(input.parentId);
  try {
    return await getDb().category.create({ data: input, select: { id: true, name: true, parentId: true } });
  } catch (e) {
    throw mapDatabaseError(e);
  }
}

export async function updateCategory(p: Principal, id: string, raw: unknown) {
  assertPermission(p, "categories.manage");
  const input = categoryPatchSchema.parse(raw);
  const db = getDb();
  if (!(await db.category.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Category");
  if (input.parentId !== undefined) await assertParent(input.parentId, id);
  try {
    return await db.category.update({ where: { id }, data: input, select: { id: true, name: true, parentId: true } });
  } catch (e) {
    throw mapDatabaseError(e);
  }
}

/** Only an empty category (no products, no sub-categories) can be deleted. */
export async function deleteCategory(p: Principal, id: string) {
  assertPermission(p, "categories.manage");
  const db = getDb();
  const cat = await db.category.findUnique({ where: { id }, select: { _count: { select: { products: true, children: true } } } });
  if (!cat) throw notFound("Category");
  if (cat._count.products || cat._count.children) {
    throw conflict("CATEGORY_IN_USE", `This category has ${cat._count.products} products and ${cat._count.children} sub-categories; move them first.`);
  }
  try {
    await db.category.delete({ where: { id } });
  } catch (e) {
    throw mapDatabaseError(e);
  }
  return { id, deleted: true };
}
