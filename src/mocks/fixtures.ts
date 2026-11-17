/**
 * Fictional, deterministic preview fixtures.
 *
 * Ported 1:1 from the Claude Design prototype (design-reference/SalesFlow.dc.html,
 * `init()`), so screens render the same figures as the design. Every business,
 * person, NIPT and phone number here is invented. Nothing in this module is read
 * by production code paths; see src/services for the API boundary.
 */
import { addDays, orderTotals } from "@/lib/money";
import type {
  BusinessSize,
  BusinessType,
  Currency,
  Customer,
  Employee,
  Invoice,
  Order,
  OrderStatus,
  Payment,
  PaymentMethod,
  Product,
  SalesDataset,
} from "@/lib/types";

/** The preview's fixed "today". All relative figures (overdue, month to date) use it. */
export const PREVIEW_TODAY = "2026-11-16";

/** Representative the `rep` preview role signs in as. */
export const PREVIEW_REP_ID = "E01";

const EMPLOYEES: [string, string, string][] = [
  ["E01", "Arben Hoxha", "Tiranë · Fier"],
  ["E02", "Elira Kola", "Durrës · Shkodër · Korçë"],
  ["E03", "Dritan Shehu", "Vlorë · Sarandë · Elbasan"],
  ["E04", "Mirela Basha", "Tiranë · Berat · Pogradec"],
];

// id, name, sku, category, unit, price (ALL cents, net), VAT %, active
const PRODUCTS: [string, string, string, string, string, number, number, boolean][] = [
  ["P-001", "Ujë Natyral 1.5L ×6", "WTR-150-6", "Beverages", "pack", 36000, 20, true],
  ["P-002", "Kafe Ekspres 1kg", "COF-1000", "Coffee", "kg", 185000, 20, true],
  ["P-003", "Vaj Ulliri Ekstra 1L", "OIL-EV-1", "Oils", "bottle", 110000, 20, true],
  ["P-004", "Makarona Spageti 500g", "PAS-500", "Pasta", "pack", 14000, 20, true],
  ["P-005", "Djathë i Bardhë", "CHE-WHT", "Dairy", "kg", 78000, 20, true],
  ["P-006", "Sheqer 1kg", "SUG-1000", "Dry goods", "kg", 12500, 20, true],
  ["P-007", "Miell Tip 00 25kg", "FLR-25", "Dry goods", "sack", 245000, 20, true],
  ["P-008", "Lëng Portokalli 1L", "JUI-ORG-1", "Beverages", "bottle", 21000, 20, true],
  ["P-009", "Qumësht UHT 1L", "MLK-UHT-1", "Dairy", "carton", 13500, 20, true],
  ["P-010", "Oriz Basmati 5kg", "RIC-BAS-5", "Dry goods", "sack", 139000, 20, false],
];

// name, NIPT, city, type, size, rep, active, contact, position, phone, street, postal, municipality
const CUSTOMERS: [string, string, string, BusinessType, BusinessSize, string, boolean, string, string, string, string, string, string][] = [
  ["Market Alba", "L61318021A", "Tiranë", "Supermarket", "Large", "E01", true, "Gentian Leka", "Purchasing manager", "+355 69 204 1180", "Rr. Myslym Shyri 42", "1001", "Tiranë"],
  ["Supermarket Teuta", "K81726403B", "Durrës", "Supermarket", "Medium", "E02", true, "Anila Dervishi", "Owner", "+355 68 311 4502", "Rr. Taulantia, Lagjja 13", "2001", "Durrës"],
  ["Hotel Butrinti Bay", "L72109955C", "Sarandë", "Hotel", "Large", "E03", true, "Klodian Rama", "F&B director", "+355 69 880 2231", "Rr. Butrinti 1", "9701", "Sarandë"],
  ["Restorant Kalaja", "J96402117D", "Berat", "Restaurant", "Small", "E04", true, "Fatos Meta", "Owner", "+355 67 455 9012", "Lagjja Kala", "5001", "Berat"],
  ["Dyqani Ylli", "L51904388E", "Tiranë", "Grocery", "Small", "E01", true, "Majlinda Hysa", "Owner", "+355 69 712 3348", "Rr. e Kavajës 118", "1004", "Tiranë"],
  ["Bar Kafe Vlora", "M02214560F", "Vlorë", "Café", "Small", "E03", true, "Erion Dauti", "Manager", "+355 68 902 6671", "Rr. Ismail Qemali 20", "9401", "Vlorë"],
  ["Market Shkodra Center", "K42019876G", "Shkodër", "Supermarket", "Medium", "E02", true, "Blerina Gjoni", "Store manager", "+355 69 330 7714", "Rr. Kolë Idromeno 9", "4001", "Shkodër"],
  ["Hotel Arbëria", "L83300142H", "Tiranë", "Hotel", "Medium", "E04", true, "Sokol Bregu", "Procurement", "+355 68 221 0945", "Rr. e Dibrës 77", "1001", "Tiranë"],
  ["Ushqimore Korça", "J71188203I", "Korçë", "Grocery", "Small", "E02", true, "Olta Nikolla", "Owner", "+355 69 618 2290", "Bulevardi Republika 31", "7001", "Korçë"],
  ["Restorant Liqeni", "L90227316J", "Pogradec", "Restaurant", "Medium", "E04", true, "Ardit Sula", "Owner", "+355 67 330 1856", "Rr. Reshit Collaku 4", "7301", "Pogradec"],
  ["Euromarket Elbasani", "K63390451K", "Elbasan", "Supermarket", "Large", "E03", true, "Valmira Toska", "Category buyer", "+355 69 455 6003", "Rr. Qemal Stafa 210", "3001", "Elbasan"],
  ["Dyqani Fresk", "M11872034L", "Fier", "Grocery", "Small", "E01", false, "Besnik Cela", "Owner", "+355 68 120 4477", "Rr. Jakov Xoxa 15", "9301", "Fier"],
  ["Hotel Riviera Dhërmi", "L94410287M", "Vlorë", "Hotel", "Medium", "E03", true, "Alketa Zaimi", "General manager", "+355 69 774 5120", "Plazhi i Dhërmiut", "9408", "Himarë"],
  ["Mini Market Lana", "L58821430N", "Tiranë", "Grocery", "Small", "E01", true, "Redon Kapllani", "Owner", "+355 69 503 8821", "Rr. Ali Demi 63", "1019", "Tiranë"],
];

// order no., customer index, date, currency, rate, status ("Invoiced" = has an invoice), items [product index, qty, disc %]
const ORDERS: [string, number, string, Currency, number, OrderStatus | "Invoiced", [number, number, number][]][] = [
  ["0403", 13, "2026-10-08", "ALL", 1, "Invoiced", [[0, 30, 0], [8, 60, 0], [5, 50, 0]]],
  ["0404", 10, "2026-10-11", "ALL", 1, "Invoiced", [[6, 30, 5], [3, 500, 5]]],
  ["0405", 2, "2026-10-15", "EUR", 98.1, "Invoiced", [[1, 10, 0], [4, 25, 0]]],
  ["0406", 8, "2026-10-20", "ALL", 1, "Invoiced", [[5, 80, 0], [3, 120, 0]]],
  ["0407", 9, "2026-10-24", "ALL", 1, "Invoiced", [[2, 12, 0], [6, 4, 0]]],
  ["0408", 0, "2026-10-29", "ALL", 1, "Invoiced", [[0, 150, 5], [5, 200, 5], [3, 300, 5], [2, 40, 5]]],
  ["0409", 5, "2026-11-02", "ALL", 1, "Invoiced", [[1, 10, 0], [8, 40, 0]]],
  ["0410", 7, "2026-11-04", "ALL", 1, "Invoiced", [[1, 6, 0], [4, 20, 0]]],
  ["0411", 6, "2026-11-06", "ALL", 1, "Invoiced", [[0, 80, 3], [8, 150, 3], [5, 120, 3]]],
  ["0412", 4, "2026-11-08", "ALL", 1, "Cancelled", [[0, 10, 0]]],
  ["0413", 12, "2026-11-10", "EUR", 97.8, "Invoiced", [[1, 8, 0], [7, 48, 0], [8, 96, 0]]],
  ["0414", 3, "2026-11-12", "ALL", 1, "Invoiced", [[2, 10, 0], [3, 60, 0], [4, 15, 0]]],
  ["0415", 10, "2026-11-13", "ALL", 1, "Invoiced", [[6, 20, 5], [5, 300, 5], [3, 400, 5]]],
  ["0416", 1, "2026-11-14", "ALL", 1, "Invoiced", [[0, 120, 4], [7, 60, 0], [8, 200, 2]]],
  ["0417", 2, "2026-11-15", "EUR", 97.8, "Confirmed", [[1, 12, 5], [2, 24, 5], [4, 30, 0]]],
  ["0418", 0, "2026-11-16", "ALL", 1, "Draft", [[0, 40, 0], [5, 100, 3]]],
];

/** Share of each invoiced order's total that has been paid. */
const PAID_FRACTION: Record<string, number> = {
  "0403": 1, "0404": 1, "0405": 0.3, "0406": 0, "0407": 0, "0408": 1, "0409": 1,
  "0410": 0.4, "0411": 1, "0413": 0, "0414": 1, "0415": 0.5, "0416": 0,
};

const METHOD_CYCLE: PaymentMethod[] = ["Bank transfer", "Cash", "Bank transfer", "Card"];

/** Payment terms in days, derived from business size (needs schema confirmation). */
export function paymentTermsDays(size: BusinessSize): number {
  return size === "Small" ? 15 : 30;
}

function emailFor(name: string): string {
  return "orders@" + name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "") + ".al";
}

export function buildPreviewDataset(today: string = PREVIEW_TODAY): SalesDataset {
  const employees: Employee[] = EMPLOYEES.map(([id, name, region]) => ({ id, name, region }));

  const products: Product[] = PRODUCTS.map(([id, name, sku, category, unit, price, vatRate, active]) => ({
    id, name, sku, category, unit, price, vatRate, active,
  }));

  const customers: Customer[] = CUSTOMERS.map((r, i) => ({
    id: "C-" + (1001 + i),
    name: r[0],
    nipt: r[1],
    city: r[2],
    type: r[3],
    size: r[4],
    repId: r[5],
    active: r[6],
    contactName: r[7],
    contactPosition: r[8],
    phone: r[9],
    street: r[10],
    postalCode: r[11],
    municipality: r[12],
    addressType: "Delivery",
    notes: "",
    email: emailFor(r[0]),
  }));

  const invoicedIds = new Set<string>();
  const orders: Order[] = ORDERS.map(([no, ci, date, currency, exchangeRate, raw, lines]) => {
    const c = customers[ci];
    // Invoiced orders carry an operational status of their own: older ones are
    // delivered, recent ones still being processed or awaiting dispatch.
    const status: OrderStatus = raw !== "Invoiced" ? raw : date <= "2026-10-31" ? "Delivered" : date <= "2026-11-10" ? "Processing" : "Confirmed";
    if (raw === "Invoiced") invoicedIds.add("SO-2026-" + no);
    const items = lines.map(([pi, quantity, discountPct]) => ({
      productId: products[pi].id,
      productName: products[pi].name,
      sku: products[pi].sku,
      unit: products[pi].unit,
      vatRate: products[pi].vatRate,
      quantity,
      discountPct,
      unitPrice: currency === "ALL" ? products[pi].price : Math.round(products[pi].price / exchangeRate),
    }));
    return {
      id: "SO-2026-" + no,
      customerId: c.id,
      repId: c.repId,
      date,
      currency,
      exchangeRate,
      status,
      deliveryAddress: c.street + ", " + c.city,
      invoiceId: null,
      items,
      ...orderTotals(items),
    };
  });

  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  orders
    .filter((o) => invoicedIds.has(o.id))
    .forEach((o, i) => {
      const c = customers.find((x) => x.id === o.customerId)!;
      const issueDate = addDays(o.date, 1);
      const fraction = PAID_FRACTION[o.id.slice(-4)] || 0;
      const inv: Invoice = {
        id: "INV-2026-0" + (301 + i),
        orderId: o.id,
        customerId: o.customerId,
        repId: o.repId,
        issueDate,
        dueDate: addDays(issueDate, paymentTermsDays(c.size)),
        currency: o.currency,
        exchangeRate: o.exchangeRate,
        net: o.net,
        discount: o.discount,
        taxable: o.taxable,
        vat: o.vat,
        total: o.total,
        paid: Math.round(o.total * fraction),
      };
      o.invoiceId = inv.id;
      invoices.push(inv);
      if (inv.paid > 0) {
        const d = addDays(issueDate, fraction === 1 ? 8 : 5);
        const method = METHOD_CYCLE[payments.length % 4];
        const prefix = method === "Cash" ? "ARK-" : method === "Card" ? "POS-" : "BKT-";
        payments.push({
          id: "PAY-2026-0" + (181 + payments.length),
          invoiceId: inv.id,
          customerId: inv.customerId,
          date: d > today ? today : d,
          amount: inv.paid,
          currency: inv.currency,
          method,
          reference: prefix + (400120 + payments.length * 37),
        });
      }
    });

  orders.reverse();
  invoices.reverse();
  payments.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  return { employees, products, customers, orders, invoices, payments };
}

/** Monthly invoiced revenue history (Jan–Oct 2026) behind the dashboard chart, in 100k ALL. */
export const REVENUE_HISTORY = {
  company: [2610, 2480, 2920, 3050, 3310, 3760, 4120, 4300, 3580, 3400],
  rep: [610, 580, 640, 700, 720, 810, 880, 910, 760, 730],
};

export const CUSTOMER_OPTIONS = {
  cities: ["Berat", "Durrës", "Elbasan", "Fier", "Korçë", "Pogradec", "Sarandë", "Shkodër", "Tiranë", "Vlorë"],
  types: ["Supermarket", "Grocery", "Restaurant", "Hotel", "Café", "Wholesale"] as BusinessType[],
  sizes: ["Small", "Medium", "Large"] as BusinessSize[],
  addressTypes: ["Delivery", "Billing", "Registered office"] as const,
};

/** Indicative exchange rates offered when switching a new order's currency. */
export const DEFAULT_RATES: Record<Currency, string> = { ALL: "1", EUR: "97.80", USD: "91.40" };

export const WAREHOUSE_PICKUP = "Pickup at warehouse, Vorë";
