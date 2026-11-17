import { describe, expect, it } from "vitest";
import { createCategory, createProduct, deleteCategory, getProduct, listCategories, listProducts, productListQuery, updateCategory, updateProduct } from "@/server/services/catalog";
import { getOrder } from "@/server/services/orders";
import { db, errorCode, invalidFields, invoicedOrder, MANAGER, NIPT, principalFor, REP_TIRANA } from "../support/fixtures";

const sku = () => "T-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
const categoryId = async () => (await db().category.findUniqueOrThrow({ where: { name: "Pije" } })).id;
const product = async (over: Record<string, unknown> = {}) => ({ sku: sku(), name: "Test product", categoryId: await categoryId(), unit: "cope", defaultNetAll: "100", vatRate: "20", ...over });

describe("products", () => {
  it("stores prices exactly up to 4 decimals and refuses more", async () => {
    const m = await principalFor(MANAGER);
    const p = await createProduct(m, await product({ defaultNetAll: "1234.5678" }));
    expect(p.defaultNetAll).toBe("1234.5678");
    expect(await invalidFields(createProduct(m, await product({ defaultNetAll: "1.23456" })))).toEqual(["defaultNetAll"]);
    expect(await invalidFields(createProduct(m, await product({ defaultNetAll: 0.1 + 0.2 })))).toEqual(["defaultNetAll"]);
    expect(await invalidFields(createProduct(m, await product({ defaultNetAll: "-1" })))).toEqual(["defaultNetAll"]);
    expect(await invalidFields(createProduct(m, await product({ vatRate: "15" })))).toEqual(["vatRate"]);
    expect((await createProduct(m, await product({ defaultNetAll: 0 }))).defaultNetAll).toBe("0.0000");
  });

  it("enforces SKU uniqueness case-insensitively and validates the category", async () => {
    const m = await principalFor(MANAGER);
    const s = sku();
    await createProduct(m, await product({ sku: s }));
    expect(await errorCode(createProduct(m, await product({ sku: s.toLowerCase() })))).toBe("DUPLICATE_SKU");
    expect(await errorCode(createProduct(m, await product({ categoryId: "00000000-0000-4000-8000-000000000000" })))).toBe("VALIDATION_FAILED");
  });

  it("only managers and admins change the catalogue; everyone can read it", async () => {
    const rep = await principalFor(REP_TIRANA);
    expect(await errorCode(createProduct(rep, await product()))).toBe("FORBIDDEN");
    const any = await db().product.findFirstOrThrow();
    expect(await errorCode(updateProduct(rep, any.id, { defaultNetAll: "1" }))).toBe("FORBIDDEN");
    expect((await listProducts(rep)).total).toBeGreaterThan(0);
  });

  it("repricing, renaming or deactivating a product never changes historical orders and invoices", async () => {
    const m = await principalFor(MANAGER);
    const p = await createProduct(m, await product({ name: "Original", defaultNetAll: "50" }));
    const { order, invoice } = await invoicedOrder({ nipt: NIPT.adriatik, lines: [{ sku: p.sku, qty: "3" }] });
    const before = await getOrder(m, order.id);
    await updateProduct(m, p.id, { name: "Renamed", defaultNetAll: "999.9999", vatRate: "6", unit: "box", isActive: false });
    const after = await getOrder(m, order.id);
    expect(after.items).toEqual(before.items);
    expect(after.totals).toEqual(before.totals);
    expect((await db().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).total.eq(invoice.total)).toBe(true);
    expect((await getProduct(m, p.id)).usedByOrderLines).toBe(1);
  });

  it("searches, filters by category and status, sorts and paginates", async () => {
    const m = await principalFor(MANAGER);
    const off = await createProduct(m, await product({ name: "Zzz inactive item", isActive: false }));
    expect((await listProducts(m, productListQuery.parse({ q: "zzz inactive" }))).items.map((p) => p.id)).toContain(off.id);
    expect((await listProducts(m, productListQuery.parse({ active: "true", pageSize: "100" }))).items.some((p) => p.id === off.id)).toBe(false);
    expect((await listProducts(m, productListQuery.parse({ categoryId: await categoryId(), pageSize: "100" }))).items.every((p) => p.category.name === "Pije")).toBe(true);
    const page = await listProducts(m, productListQuery.parse({ pageSize: "2", sort: "sku", dir: "desc" }));
    expect(page.items).toHaveLength(2);
    expect(page.items[0].sku > page.items[1].sku).toBe(true);
    expect(productListQuery.safeParse({ sort: "category" }).success).toBe(false);
  });
});

describe("categories", () => {
  it("creates, renames, nests without cycles, and deletes only empty categories", async () => {
    const m = await principalFor(MANAGER);
    const name = "Cat " + Date.now();
    const parent = await createCategory(m, { name });
    expect(await errorCode(createCategory(m, { name }))).toBe("DUPLICATE_CATEGORY");
    const child = await createCategory(m, { name: name + " child", parentId: parent.id });
    expect(await errorCode(updateCategory(m, parent.id, { parentId: child.id }))).toBe("VALIDATION_FAILED"); // cycle
    expect(await errorCode(updateCategory(m, parent.id, { parentId: parent.id }))).toBe("VALIDATION_FAILED");
    expect((await updateCategory(m, child.id, { name: name + " renamed" })).name).toBe(name + " renamed");
    expect(await errorCode(deleteCategory(m, parent.id))).toBe("CATEGORY_IN_USE"); // has a child
    expect(await errorCode(deleteCategory(m, await categoryId()))).toBe("CATEGORY_IN_USE"); // has products
    await deleteCategory(m, child.id);
    await deleteCategory(m, parent.id);
    expect((await listCategories(m)).items.some((c) => c.id === parent.id)).toBe(false);
  });

  it("reports product counts and units; representatives can read but not manage", async () => {
    const rep = await principalFor(REP_TIRANA);
    const pije = (await listCategories(rep)).items.find((c) => c.name === "Pije")!;
    expect(pije.productCount).toBeGreaterThanOrEqual(2);
    expect(pije.units).toContain("cope");
    expect(await errorCode(createCategory(rep, { name: "Nope" }))).toBe("FORBIDDEN");
  });
});
