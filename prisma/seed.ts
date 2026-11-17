import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma, UserRole, BusinessType, BusinessSize, OrderStatus, PaymentMethod, AIMessageRole } from '../src/generated/prisma/client';
import type { Product } from '../src/generated/prisma/client';
import { hash } from 'bcryptjs';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const D = (x: string | number) => new Prisma.Decimal(x);
const money = (x: Prisma.Decimal) => x.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const calc = (qty: string, price: string, discount: string, vat: string) => {
  const grossNet = money(D(qty).mul(price));
  const discountAmount = money(grossNet.mul(discount).div(100));
  const taxableAmount = grossNet.minus(discountAmount);
  const vatAmount = money(taxableAmount.mul(vat).div(100));
  return { grossNet, discountAmount, taxableAmount, vatAmount, lineTotal: taxableAmount.plus(vatAmount) };
};

// DEVELOPMENT DATA ONLY. Fictional companies and four demo logins that share one
// password (SEED_DEMO_PASSWORD, see .env.example). Never run against production.
// No built-in fallback password: the demo password must come from the environment,
// so a seed run by mistake never creates accounts with a password published in this repository.
function demoPassword(): string {
  const pw = process.env.SEED_DEMO_PASSWORD ?? '';
  if (pw.length < 12) throw new Error('Set SEED_DEMO_PASSWORD (at least 12 characters) to seed the demo accounts.');
  return pw;
}

/** The seed only targets a local database unless SEED_ALLOW_REMOTE=true is set explicitly. */
function assertLocalDatabase() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? '').hostname; } catch { return ''; } })();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && process.env.SEED_ALLOW_REMOTE !== 'true') {
    throw new Error(`Refusing to seed demo data into a non-local database (${host || 'unknown host'}). Set SEED_ALLOW_REMOTE=true only for a disposable environment.`);
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo accounts with NODE_ENV=production.');
  // Seed is repeatable: use fixed natural keys and skip previously created orders.
  assertLocalDatabase();
  const pw = await hash(demoPassword(), 12);
  const people: { email: string; role: UserRole; first: string; last: string }[] = [
    { email: 'admin@salesflow.test', role: 'ADMIN', first: 'Arben', last: 'Dervishi' },
    { email: 'manager@salesflow.test', role: 'SALES_MANAGER', first: 'Elira', last: 'Kola' },
    { email: 'rep.tirana@salesflow.test', role: 'SALES_REPRESENTATIVE', first: 'Erion', last: 'Hoxha' },
    { email: 'rep.korce@salesflow.test', role: 'SALES_REPRESENTATIVE', first: 'Mira', last: 'Leka' },
  ];
  const employees = [];
  for (const p of people) {
    const user = await db.user.upsert({ where: { email: p.email }, update: {}, create: { email: p.email, passwordHash: pw, role: p.role } });
    let emp = await db.employee.findUnique({ where: { userId: user.id } });
    if (!emp) emp = await db.employee.create({ data: { userId: user.id, firstName: p.first, lastName: p.last } });
    employees.push({ ...p, user, emp });
  }
  for (const [code, name] of [['ALL', 'Albanian lek'], ['EUR', 'Euro'], ['USD', 'US dollar']]) {
    await db.currency.upsert({ where: { code }, update: {}, create: { code, name } });
  }
  const rateDate = new Date('2026-10-01T00:00:00Z');
  for (const [code, rate] of [['ALL', '1'], ['EUR', '100'], ['USD', '90']]) {
    await db.exchangeRate.upsert({ where: { currencyCode_effectiveAt: { currencyCode: code, effectiveAt: rateDate } }, update: {}, create: { currencyCode: code, effectiveAt: rateDate, allPerUnit: D(rate) } });
  }
  const categoryNames = ['Pije', 'Ushqime', 'Produkte higjiene'];
  const categories = await Promise.all(categoryNames.map(name => db.category.upsert({ where: { name }, update: {}, create: { name } })));
  const specs = [
    ['DRK-001', 'Uje mineral 1.5L', 0, 'cope', '80', '20'],
    ['DRK-002', 'Leng molle 1L', 0, 'cope', '150', '20'],
    ['FOD-001', 'Oriz 1kg', 1, 'kg', '220', '20'],
    ['FOD-002', 'Miell 1kg', 1, 'kg', '95', '20'],
    ['HYG-001', 'Sapun 100g', 2, 'cope', '120', '20'],
    ['FOD-003', 'Produkt ushqimor me norme testuese 0%', 1, 'cope', '50', '0'],
  ] as const;
  const products: Product[] = [];
  for (const [sku, name, ci, unit, price, vat] of specs) {
    products.push(await db.product.upsert({ where: { sku }, update: {}, create: { sku, name, categoryId: categories[ci].id, unit, defaultNetAll: D(price), vatRate: D(vat) } }));
  }
  const customerSpecs = [
    ['L12345678A', 'Market Alba SHPK', 'Tirane', BusinessType.SUPERMARKET, 2],
    ['L23456789B', 'Distribucion Adriatik SHPK', 'Durres', BusinessType.WHOLESALER, 2],
    ['L34567890C', 'Restorant Liqeni SHPK', 'Pogradec', BusinessType.RESTAURANT, 3],
    ['L45678901D', 'Hotel Korca SHPK', 'Korce', BusinessType.HOTEL, 3],
    ['L56789012E', 'Ushqimore Shkodra SHPK', 'Shkoder', BusinessType.GROCERY, 2],
  ] as const;
  const customers = [];
  for (const [nipt, businessName, city, businessType, repIndex] of customerSpecs) {
    let customer = await db.customer.findUnique({ where: { nipt }, include: { addresses: true, contacts: true } });
    if (!customer) customer = await db.customer.create({ data: {
      nipt, businessName, city, municipality: city, businessType, businessSize: BusinessSize.SMALL, assignedRepId: employees[repIndex].emp.id,
      contacts: { create: [{ fullName: 'Kontakt ' + businessName, phone: '+355690000000', isPrimary: true }] },
      addresses: { create: [{ street: 'Rruga e Tregtise, Nr. 10', city, type: 'BOTH', isDefault: true }] },
    }, include: { addresses: true, contacts: true } });
    customers.push(customer);
  }
  type Line = { index: number; qty: string; discount: string; overrideAll?: string };
  type OrderSpec = { number: string; ordered: string; customer: number; currency: string; rate: string; lines: Line[]; payments: string[]; due: string };
  const orders: OrderSpec[] = [
    { number: 'SO-2026-001', ordered: '2026-10-03', customer: 0, currency: 'ALL', rate: '1', lines: [{ index: 0, qty: '20', discount: '0' }, { index: 2, qty: '10', discount: '10' }], payments: ['1000', '2920'], due: '2026-11-30' },
    { number: 'SO-2026-002', ordered: '2026-10-07', customer: 1, currency: 'EUR', rate: '100', lines: [{ index: 1, qty: '30', discount: '0' }, { index: 4, qty: '10', discount: '5' }], payments: ['20'], due: '2026-11-01' },
    { number: 'SO-2026-003', ordered: '2026-10-10', customer: 2, currency: 'USD', rate: '90', lines: [{ index: 3, qty: '40', discount: '0' }, { index: 5, qty: '20', discount: '0' }], payments: [], due: '2026-12-15' },
    { number: 'SO-2026-004', ordered: '2026-10-13', customer: 3, currency: 'ALL', rate: '1', lines: [{ index: 0, qty: '12', discount: '0' }, { index: 4, qty: '8', discount: '0' }], payments: ['2304'], due: '2026-11-10' },
  ];
  // Timeline: orders 3-13 Oct, all invoiced 15 Oct, payments 20 Oct.
  for (const spec of orders) {
    const orderDate = new Date(spec.ordered + 'T09:00:00Z');
    if (await db.order.findUnique({ where: { orderNumber: spec.number } })) {
      // Earlier seeds used now() as the order date, which put orders after their
      // invoices. Correct those rows in place (order_date is not a locked field).
      await db.order.updateMany({ where: { orderNumber: spec.number, orderDate: { not: orderDate } }, data: { orderDate } });
      continue;
    }
    const customer = customers[spec.customer];
    const items = spec.lines.map(l => {
      const product = products[l.index];
      const unitNetPrice = D(l.overrideAll ?? product.defaultNetAll.toString()).div(spec.rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      return { productId: product.id, productSku: product.sku, productName: product.name, unit: product.unit,
        quantity: D(l.qty), unitNetPrice, discountPercent: D(l.discount), vatRate: product.vatRate,
        ...calc(l.qty, unitNetPrice.toString(), l.discount, product.vatRate.toString()) };
    });
    const sum = (key: 'grossNet' | 'discountAmount' | 'taxableAmount' | 'vatAmount' | 'lineTotal') => items.reduce((v, i) => v.plus(i[key]), D(0));
    const totals = { subtotalNet: sum('grossNet'), discountTotal: sum('discountAmount'), taxableTotal: sum('taxableAmount'), vatTotal: sum('vatAmount'), grandTotal: sum('lineTotal') };
    const invoiceNumber = spec.number.replace('SO-', 'INV-');
    await db.$transaction(async tx => {
      const order = await tx.order.create({ data: { orderNumber: spec.number, customerId: customer.id,
        salesRepId: customer.assignedRepId!, deliveryAddressId: customer.addresses[0].id,
        deliverySnapshot: { street: customer.addresses[0].street, city: customer.addresses[0].city },
        currencyCode: spec.currency, allPerUnit: D(spec.rate), status: OrderStatus.CONFIRMED, orderDate, ...totals,
        items: { create: items } } });
      const invoice = await tx.invoice.create({ data: { invoiceNumber, orderId: order.id, currencyCode: spec.currency,
        allPerUnit: D(spec.rate), subtotalNet: totals.subtotalNet, discountTotal: totals.discountTotal,
        taxableTotal: totals.taxableTotal, vatTotal: totals.vatTotal, total: totals.grandTotal,
        issueDate: new Date('2026-10-15T00:00:00Z'), dueDate: new Date(spec.due + 'T00:00:00Z') } });
      let paid = D(0);
      for (let i = 0; i < spec.payments.length; i++) {
        const amount = D(spec.payments[i]);
        if (paid.plus(amount).gt(invoice.total)) throw new Error(`Seed overpayment ${invoiceNumber}: ${paid.plus(amount)} > ${invoice.total}`);
        await tx.payment.create({ data: { invoiceId: invoice.id, paymentDate: new Date('2026-10-20T00:00:00Z'), amount,
          currencyCode: spec.currency, method: PaymentMethod.BANK_TRANSFER, reference: `${invoiceNumber}-PAY-${i + 1}` } });
        paid = paid.plus(amount);
      }
    });
  }
  // New invoices continue after the seeded INV-2026-00n numbers (see the invoice_numbering migration).
  await db.$executeRaw`SELECT sync_invoice_number_counters()`;
  const conversation = await db.aIConversation.findFirst({ where: { userId: employees[1].user.id, title: 'Raporti i shitjeve' } });
  if (!conversation) await db.aIConversation.create({ data: { userId: employees[1].user.id, title: 'Raporti i shitjeve', messages: { create: [
    { role: AIMessageRole.USER, content: 'Cilet kliente kane fatura te papaguara?' },
    { role: AIMessageRole.ASSISTANT, content: 'Bisedë demonstrimi. Rezultatet duhet të merren nga mjetet e autorizuara gjatë përdorimit real.' },
  ] } } });
  console.log('Seed complete. DEVELOPMENT DATA ONLY: demo logins share SEED_DEMO_PASSWORD; never deploy them.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
