import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { createOrder, db, freshNipt, NIPT } from "../support/fixtures";
import { base } from "../support/http";

/**
 * Browser tests for the database-backed screens, in the system Chrome against
 * `next start` on the throwaway test database. Skipped without a production
 * build or without Chrome.
 */
let browser: Browser | undefined;
const errors: string[] = [];

beforeAll(async () => {
  if (!base) return;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    browser = undefined;
  }
});
afterAll(async () => browser?.close());

async function signedIn(email: string): Promise<Page> {
  const ctx = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" || /status of (401|403|404|409|422)/.test(m.text())) return;
    // The assistant outage test answers 503 on purpose; any other 503 still fails the suite.
    if (/status of 503/.test(m.text()) && /\/api\/assistant\/conversations\/[^/]+\/messages$/.test(m.location().url)) return;
    errors.push(`${email}: ${m.text()} (${m.location().url})`);
  });
  await page.goto(base + "/login");
  await page.fill("#lg-email", email);
  await page.fill("#lg-pw", DEMO_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard");
  return page;
}

// Next.js keeps recently visited pages in the DOM (hidden) for instant back
// navigation, so every lookup counts visible elements only.
const rowWith = (page: Page, text: string) => page.locator("tbody tr", { hasText: text }).filter({ visible: true });
const visibleText = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true });

describe.skipIf(!base)("database-backed screens in the browser", () => {
  it("customers: lists real records, searches and paginates, with no preview banner", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/customers");
    await expect.poll(() => rowWith(page, "Market Alba SHPK").count()).toBe(1);
    expect(await visibleText(page, "Euromarket Elbasani").count()).toBe(0); // fixture customers are gone
    expect(await page.getByRole("note").filter({ visible: true }).count()).toBe(0); // no preview notice on live screens
    await page.getByLabel("Search customers", { exact: true }).fill("liqeni");
    await expect.poll(() => page.locator("tbody tr").filter({ visible: true }).count()).toBe(1);
    await expect.poll(() => rowWith(page, "Restorant Liqeni SHPK").count()).toBe(1);
    await page.getByLabel("Search customers", { exact: true }).fill("");
    await expect.poll(async () => (await visibleText(page, /^\d+–\d+ of \d+$/).first().textContent()) ?? "").toMatch(/^1–\d+ of \d+$/);
    await page.context().close();
  });

  it("registers a customer, rejects a duplicate NIPT, and manages contacts", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    const nipt = freshNipt();
    const name = "Browser Kafe " + nipt.slice(1, 6);
    await page.goto(base + "/customers/new");
    await page.fill("#cf-name", name);
    await page.fill("#cf-nipt", nipt.toLowerCase());
    await page.selectOption("#cf-type", "CAFE");
    await page.selectOption("#cf-size", "SMALL");
    await page.fill("#cf-contact", "Arta Kafe");
    await page.fill("#cf-phone", "+355 69 555 0101");
    await page.selectOption("#cf-city", "Tiranë");
    await page.fill("#cf-street", "Rr. Kafeve 3");
    await expect.poll(() => page.locator("#cf-rep option").count()).toBeGreaterThan(1);
    await page.selectOption("#cf-rep", { label: "Erion Hoxha" });
    await page.getByRole("button", { name: "Save customer" }).click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect.poll(() => page.locator("h1.page-title").filter({ visible: true }).textContent()).toBe(name);
    expect(await visibleText(page, `NIPT ${nipt}`).count()).toBe(1);

    // Contacts tab: add a second contact through the dialog.
    await page.getByRole("tab", { name: /Contacts/ }).click();
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.fill("#ct-name", "Besa Second");
    await page.fill("#ct-email", "besa@example.al");
    await page.getByRole("button", { name: "Save contact" }).click();
    await expect.poll(() => rowWith(page, "Besa Second").count()).toBe(1);

    // Duplicate NIPT is reported on the field.
    await page.goto(base + "/customers/new");
    await page.fill("#cf-name", "Duplicate");
    await page.fill("#cf-nipt", nipt);
    await page.selectOption("#cf-type", "GROCERY");
    await page.selectOption("#cf-size", "SMALL");
    await page.fill("#cf-contact", "X");
    await page.fill("#cf-phone", "+355 69 000 0000");
    await page.selectOption("#cf-city", "Tiranë");
    await page.fill("#cf-street", "Rr. 1");
    await expect.poll(() => page.locator("#cf-rep option").count()).toBeGreaterThan(1);
    await page.selectOption("#cf-rep", { label: "Erion Hoxha" });
    await page.getByRole("button", { name: "Save customer" }).click();
    await expect.poll(() => page.locator("#cf-nipt-error").textContent()).toContain("already exists");
    await page.context().close();
  });

  it("edits a customer and shows its read-only order history", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/customers");
    await rowWith(page, "Market Alba SHPK").click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
    await page.getByRole("tab", { name: /Orders/ }).click();
    await expect.poll(() => rowWith(page, "SO-2026-001").count()).toBe(1);
    await page.getByRole("button", { name: "Edit customer" }).click();
    await page.waitForURL(/\/edit$/);
    await page.fill("#cf-notes", "Receiving dock opens at 07:00");
    await page.getByRole("button", { name: "Save customer" }).click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
    // The detail page keeps its UI state (Orders tab) across the edit round trip.
    await page.getByRole("tab", { name: "Overview" }).filter({ visible: true }).click();
    await expect.poll(() => visibleText(page, "Receiving dock opens at 07:00").count()).toBe(1);
    await page.context().close();
  });

  it("products: creates with 4-decimal precision and shows validation errors", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/products");
    await expect.poll(() => rowWith(page, "DRK-001").count()).toBe(1);
    await page.getByRole("button", { name: "New product" }).click();
    const sku = "BRW-" + Date.now().toString(36).toUpperCase();
    await page.fill("#pf-name", "Browser test juice");
    await page.fill("#pf-sku", sku);
    await expect.poll(() => page.locator("#pf-cat option").count()).toBeGreaterThan(1);
    await page.selectOption("#pf-cat", { label: "Pije" });
    await page.fill("#pf-unit", "cope");
    await page.fill("#pf-price", "1.23456");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect.poll(() => page.locator("#pf-price-error").textContent()).toContain("4 decimal places");
    await page.fill("#pf-price", "12.3456");
    await page.getByRole("button", { name: "Save product" }).click();
    await page.getByLabel("Search products", { exact: true }).fill(sku);
    await expect.poll(() => rowWith(page, sku).locator("td.num").textContent()).toBe("12.3456");
    await page.context().close();
  });

  it("categories, employees and exchange rates work for a manager", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/categories");
    await page.getByRole("button", { name: "New category" }).click();
    const cat = "Browser cat " + Date.now();
    await page.fill("#cat-name", cat);
    await page.getByRole("button", { name: "Save category" }).click();
    await expect.poll(() => rowWith(page, cat).count()).toBe(1);
    await rowWith(page, cat).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete category" }).click();
    await expect.poll(() => rowWith(page, cat).count()).toBe(0);

    await page.goto(base + "/employees");
    await expect.poll(() => rowWith(page, "Erion Hoxha").count()).toBe(1);
    await rowWith(page, "Erion Hoxha").click();
    const drawer = page.getByRole("dialog").filter({ visible: true });
    await expect.poll(() => drawer.getByText("Market Alba SHPK").count()).toBe(1);
    expect(await drawer.getByRole("button", { name: "Deactivate" }).count()).toBe(0); // managers can't

    await page.goto(base + "/settings");
    await page.fill("#rate-val", "97.65");
    await page.fill("#rate-date", "2026-11-17");
    await page.getByRole("button", { name: "Save rate" }).click();
    await expect.poll(() => page.getByText("1 EUR = 97.65 ALL", { exact: true }).filter({ visible: true }).count()).toBe(1);
    await page.context().close();
  });

  it("a representative sees only their customers and no management actions", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("rep.korce@salesflow.test");
    await page.goto(base + "/customers");
    await expect.poll(() => rowWith(page, "Hotel Korca SHPK").count()).toBe(1);
    expect(await rowWith(page, "Market Alba SHPK").count()).toBe(0);
    await page.goto(base + "/products");
    await expect.poll(() => rowWith(page, "DRK-001").count()).toBe(1);
    expect(await page.getByRole("button", { name: "New product" }).count()).toBe(0);
    for (const path of ["/employees", "/categories", "/settings"]) {
      await page.goto(base + path);
      await page.waitForURL("**/dashboard");
    }
    await page.context().close();
  });

  it("assistant: answers from real data with links, keeps history, no preview banner", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/assistant");
    expect(await page.getByRole("note").filter({ visible: true }).count()).toBe(0); // no "Preview data" notice anywhere now
    await expect.poll(() => visibleText(page, "Offline test provider · not a language model").count()).toBe(1);
    const box = page.getByLabel("Message", { exact: true }).filter({ visible: true });
    await box.fill("What is the status of INV-2026-002?");
    await box.press("Enter");
    await expect.poll(() => visibleText(page, /INV-2026-002: total 67\.68 EUR, outstanding 47\.68 EUR/).count(), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => visibleText(page, "Sources: invoice details").count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: /What is the status of INV-2026-002\?/ }).filter({ visible: true }).count()).toBeGreaterThan(0); // history
    await page.getByRole("link", { name: "INV-2026-002" }).filter({ visible: true }).click();
    await expect.poll(() => page.getByRole("dialog", { name: "Invoice details" }).getByRole("heading", { name: "INV-2026-002" }).count()).toBe(1);
    await page.context().close();
  });

  it("assistant: a provider outage shows a safe error, and suggestions fill the box", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("rep.korce@salesflow.test");
    await page.goto(base + "/assistant");
    await expect.poll(() => visibleText(page, "Answers are limited to your assigned customers and your own sales.").count()).toBe(1);
    await page.getByRole("button", { name: "Which invoices are overdue?" }).filter({ visible: true }).click();
    const box = page.getByLabel("Message", { exact: true }).filter({ visible: true });
    expect(await box.inputValue()).toBe("Which invoices are overdue?");
    await box.fill("[provider-down] sales this month");
    await page.getByRole("button", { name: "Send" }).filter({ visible: true }).click();
    await expect.poll(() => visibleText(page, /The AI service is unavailable right now/).count(), { timeout: 10_000 }).toBe(1);
    await page.context().close();
  });

  it("orders: creates an order with server-confirmed totals, then confirms it from the drawer", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/orders");
    await expect.poll(() => rowWith(page, "SO-2026-001").count()).toBe(1);
    expect(await page.getByRole("note").filter({ visible: true }).count()).toBe(0); // orders are live: no preview banner

    await page.goto(base + "/orders/new");
    await page.click("#no-cust");
    await page.keyboard.type("Adriatik");
    await page.getByRole("option", { name: /Distribucion Adriatik SHPK/ }).filter({ visible: true }).click();
    await page.locator(".seg-opt", { hasText: "EUR" }).filter({ visible: true }).click();
    await expect.poll(() => page.locator("#no-rate").inputValue()).toMatch(/^\d+\.\d{2,}$/);
    const product = page.getByLabel("Product, line 1", { exact: true }).filter({ visible: true });
    await product.click();
    await page.keyboard.type("FOD-001");
    await page.getByRole("option", { name: /Oriz 1kg/ }).filter({ visible: true }).click();
    await page.getByLabel("Quantity, line 1", { exact: true }).filter({ visible: true }).fill("12.5");
    await page.getByLabel("Discount percent, line 1", { exact: true }).filter({ visible: true }).fill("5");
    await expect.poll(() => visibleText(page, "Confirmed by server").count()).toBe(1);
    const shown = (await page.locator("span.font-heading.text-\\[24px\\]").filter({ visible: true }).textContent())!.trim();

    await page.getByRole("button", { name: "Save as draft" }).click();
    await page.waitForURL("**/orders");
    const drawer = page.getByRole("dialog").filter({ visible: true });
    const badge = (label: string) => drawer.locator(".tag").filter({ hasText: new RegExp(`^${label}$`) });
    await expect.poll(() => badge("Draft").count()).toBe(1);
    await expect.poll(() => drawer.getByText(shown, { exact: true }).count()).toBe(1); // saved total = the server-confirmed figure
    await drawer.getByRole("button", { name: "Confirm order" }).click();
    await expect.poll(() => badge("Confirmed").count()).toBe(1);
    await expect.poll(() => drawer.getByRole("button", { name: "Mark as processing" }).count()).toBe(1);
    await page.context().close();
  });

  it("orders: a representative can't change prices and sees only their orders", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("rep.korce@salesflow.test");
    await page.goto(base + "/orders");
    await expect.poll(() => rowWith(page, "SO-2026-003").count()).toBe(1);
    expect(await rowWith(page, "SO-2026-001").count()).toBe(0);
    await page.goto(base + "/orders/new");
    const product = page.getByLabel("Product, line 1", { exact: true }).filter({ visible: true });
    await product.click();
    await page.keyboard.type("DRK-001");
    await page.getByRole("option", { name: /DRK-001/ }).filter({ visible: true }).click();
    const price = page.getByLabel("Unit price, line 1", { exact: true }).filter({ visible: true });
    await expect.poll(() => price.inputValue()).toBe("80.0000");
    expect(await price.getAttribute("readonly")).not.toBeNull();
    await page.context().close();
  });

  it("customer page starts an order for that customer", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("rep.tirana@salesflow.test");
    const alba = await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.marketAlba } });
    await page.goto(base + "/customers/" + alba.id);
    await expect.poll(() => page.locator("h1.page-title").filter({ visible: true }).textContent()).toBe("Market Alba SHPK");
    await page.locator("main").getByRole("button", { name: "New order" }).filter({ visible: true }).click();
    await page.waitForURL(/\/orders\/new\?customer=/);
    await expect.poll(() => page.locator("#no-cust").filter({ visible: true }).inputValue()).toContain("Market Alba SHPK");
    await page.context().close();
  });

  it("invoices: issues an invoice from a confirmed order, then records a partial payment", async (ctx) => {
    if (!browser) return ctx.skip();
    const order = await createOrder({ nipt: NIPT.adriatik, lines: [{ sku: "DRK-001", qty: "10" }] }); // 960.00 ALL
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/orders");
    await page.getByLabel("Search orders", { exact: true }).fill(order.orderNumber);
    await expect.poll(() => rowWith(page, order.orderNumber).count()).toBe(1);
    await rowWith(page, order.orderNumber).click();
    const drawer = page.getByRole("dialog", { name: "Order details" });
    await drawer.getByRole("button", { name: "Issue invoice" }).click();
    const dialog = page.getByRole("dialog", { name: `Issue invoice for ${order.orderNumber}` });
    await expect.poll(() => dialog.locator("#dd-due").inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await dialog.getByRole("button", { name: "Issue invoice" }).click();
    await expect.poll(() => drawer.locator(".tag").filter({ hasText: /^Invoiced$/ }).count()).toBe(1);
    const invoice = await db().invoice.findFirstOrThrow({ where: { orderId: order.id } });
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice.total.toFixed(2)).toBe("960.00");

    // The order drawer links to the invoice drawer.
    await drawer.getByRole("link", { name: invoice.invoiceNumber }).click();
    await page.waitForURL("**/invoices");
    expect(await page.getByRole("note").filter({ visible: true }).count()).toBe(0); // invoices are live: no preview banner
    const inv = page.getByRole("dialog", { name: "Invoice details" });
    await expect.poll(() => inv.getByRole("heading", { name: invoice.invoiceNumber }).count()).toBe(1);
    await inv.getByRole("button", { name: "Register payment" }).click();
    const pay = page.getByRole("dialog", { name: "Register payment" });
    await expect.poll(() => pay.getByText("960.00 ALL").count()).toBeGreaterThan(0);
    await pay.locator("#pd-amt").fill("960.01");
    await expect.poll(() => pay.getByText("Exceeds the outstanding balance of 960.00 ALL.").count()).toBe(1);
    await pay.locator("#pd-amt").fill("400");
    await pay.locator("#pd-ref").fill("BKT-UI-1");
    await pay.getByRole("button", { name: "Record payment" }).click();
    await expect.poll(() => inv.locator(".tag").filter({ hasText: /^Partial$/ }).count()).toBe(1);
    await expect.poll(() => inv.getByText("560.00 ALL").count()).toBeGreaterThan(0);
    expect(await db().payment.count({ where: { invoiceId: invoice.id } })).toBe(1);

    await page.goto(base + "/payments");
    await page.getByLabel("Search payments", { exact: true }).fill("BKT-UI-1");
    await expect.poll(() => rowWith(page, invoice.invoiceNumber).count()).toBe(1);
    await page.context().close();
  });

  it("invoices: cancels with a reason and issues a replacement", async (ctx) => {
    if (!browser) return ctx.skip();
    const order = await createOrder({ nipt: NIPT.adriatik });
    const page = await signedIn("admin@salesflow.test");
    const res = await page.request.post(base + "/api/invoices", { data: { orderId: order.id, dueDate: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) } });
    expect(res.status()).toBe(201);
    const first = (await res.json()).invoice;
    await page.goto(base + "/invoices");
    await page.getByLabel("Search invoices", { exact: true }).fill(first.invoiceNumber);
    await expect.poll(() => rowWith(page, first.invoiceNumber).count()).toBe(1);
    await rowWith(page, first.invoiceNumber).click();
    const inv = page.getByRole("dialog", { name: "Invoice details" });
    await inv.getByRole("button", { name: "Cancel invoice" }).click();
    const cancel = page.getByRole("alertdialog", { name: `Cancel ${first.invoiceNumber}?` });
    await cancel.getByRole("button", { name: "Cancel invoice" }).click();
    await expect.poll(() => cancel.getByText("Give a reason of at least 3 characters.").count()).toBe(1);
    await cancel.locator("#ci-reason").fill("Customer changed billing details");
    await cancel.getByRole("button", { name: "Cancel invoice" }).click();
    await expect.poll(() => inv.locator(".tag").filter({ hasText: /^Cancelled$/ }).count()).toBe(1);
    await expect.poll(() => inv.getByText(/Customer changed billing details/).count()).toBe(1);
    await inv.getByRole("button", { name: "Issue replacement invoice" }).click();
    await page.getByRole("dialog", { name: `Replace ${first.invoiceNumber}` }).getByRole("button", { name: "Issue replacement" }).click();
    await expect.poll(() => inv.getByText("Replaces").count()).toBe(1);
    const repl = await db().invoice.findFirstOrThrow({ where: { replacesInvoiceId: first.id } });
    await expect.poll(() => inv.getByRole("heading", { name: repl.invoiceNumber }).count()).toBe(1);
    await page.context().close();
  });

  it("invoices: a representative sees their invoices read-only", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("rep.korce@salesflow.test");
    await page.goto(base + "/invoices");
    await expect.poll(() => rowWith(page, "INV-2026-003").count()).toBe(1); // Restorant Liqeni (own customer)
    expect(await rowWith(page, "INV-2026-001").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Register payment" }).filter({ visible: true }).count()).toBe(0);
    await rowWith(page, "INV-2026-003").click();
    const inv = page.getByRole("dialog", { name: "Invoice details" });
    await expect.poll(() => inv.getByRole("heading", { name: "INV-2026-003" }).count()).toBe(1);
    expect(await inv.getByRole("button").filter({ hasText: /Register payment|Cancel invoice|replacement/ }).count()).toBe(0);
    await page.goto(base + "/payments");
    await expect.poll(() => page.locator("tbody tr").filter({ visible: true }).count()).toBeGreaterThanOrEqual(0);
    expect(await rowWith(page, "INV-2026-001").count()).toBe(0);
    await page.context().close();
  });

  it("dashboard: real figures with a period filter and links to records", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/dashboard");
    expect(await page.getByRole("note").filter({ visible: true }).count()).toBe(0); // live: no preview banner
    await expect.poll(() => visibleText(page, "Outstanding receivables").count()).toBeGreaterThan(0);
    const panel = (title: string) => page.locator(".blueprint").filter({ visible: true }).filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    const recentOrders = panel("Recent orders");
    await expect.poll(() => recentOrders.locator("tbody tr").filter({ hasText: /SO-|T-/ }).count()).toBeGreaterThan(0); // database orders, not fixture data
    expect(await visibleText(page, "Euromarket Elbasani").count()).toBe(0);
    const outstanding = panel("Outstanding invoices");
    const firstOpen = outstanding.locator("tbody tr").first();
    const number = ((await firstOpen.locator("td").first().textContent()) ?? "").trim();
    expect(number).toMatch(/^(INV|TI)-/);
    await page.locator(".seg-opt", { hasText: "This year" }).filter({ visible: true }).click();
    await expect.poll(() => visibleText(page, /^1 Jan – \d+ \w+ \d{4} · net of VAT$/).count()).toBe(1);
    await page.locator(".seg-opt", { hasText: /^Custom$/ }).filter({ visible: true }).click();
    await page.locator("#db-from").fill("2019-01-01");
    await page.locator("#db-to").fill("2019-01-31");
    await expect.poll(() => visibleText(page, "1–31 Jan 2019 · net of VAT").count()).toBe(1);
    await expect.poll(() => visibleText(page, "No invoices issued in this period.").count()).toBe(1);
    await outstanding.locator("tbody tr").first().click();
    await expect.poll(() => page.getByRole("dialog", { name: "Invoice details" }).getByRole("heading", { name: number }).count()).toBe(1);
    await page.context().close();
  });

  it("reports: switches groupings, currency basis and receivables", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("manager@salesflow.test");
    await page.goto(base + "/reports");
    expect(await page.getByRole("note").filter({ visible: true }).count()).toBe(0);
    await page.locator(".seg-opt", { hasText: /^Custom$/ }).filter({ visible: true }).click();
    await page.locator("#rp-from").fill("2026-10-01");
    await page.locator("#rp-to").fill("2026-10-31");
    await expect.poll(() => rowWith(page, "Erion Hoxha").count()).toBe(1); // seeded invoices, issued 15 Oct
    await expect.poll(() => visibleText(page, "4 issued invoices · by issue date").count()).toBe(1);
    await page.locator(".seg-opt", { hasText: /^Customer$/ }).filter({ visible: true }).click();
    await expect.poll(() => rowWith(page, "Restorant Liqeni SHPK").count()).toBe(1);
    await page.locator(".seg-opt", { hasText: "EUR only" }).filter({ visible: true }).click();
    await expect.poll(() => rowWith(page, "Distribucion Adriatik SHPK").count()).toBe(1);
    expect(await rowWith(page, "Restorant Liqeni SHPK").count()).toBe(0);
    await page.locator(".seg-opt", { hasText: "All → ALL" }).filter({ visible: true }).click();
    await page.locator(".seg-opt", { hasText: "Overdue" }).filter({ visible: true }).click();
    await expect.poll(() => page.locator("th", { hasText: "Days overdue" }).filter({ visible: true }).count()).toBe(1);
    await expect.poll(() => page.locator("tbody tr").filter({ visible: true }).filter({ hasText: /^(INV|TI)-/ }).count()).toBeGreaterThan(0);
    await page.locator(".seg-opt", { hasText: "Collections" }).filter({ visible: true }).click();
    await expect.poll(() => rowWith(page, "20 Oct 2026").count()).toBe(1); // seeded payments
    await page.context().close();
  });

  it("reports: a representative sees only their own figures", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await signedIn("rep.korce@salesflow.test");
    await page.goto(base + "/reports");
    await page.locator(".seg-opt", { hasText: /^Custom$/ }).filter({ visible: true }).click();
    await page.locator("#rp-from").fill("2026-10-01");
    await page.locator("#rp-to").fill("2026-10-31");
    await page.locator(".seg-opt", { hasText: /^Customer$/ }).filter({ visible: true }).click();
    await expect.poll(() => rowWith(page, "Restorant Liqeni SHPK").count()).toBe(1);
    expect(await rowWith(page, "Market Alba SHPK").count()).toBe(0);
    await page.context().close();
  });

  it("produced no page or console errors", (ctx) => {
    if (!browser) return ctx.skip();
    expect(errors).toEqual([]);
  });
});
