import type { getCustomer, listCustomers } from "@/server/services/customers";
import type { getEmployee, listEmployees } from "@/server/services/employees";
import type { getProduct, listCategories, listProducts } from "@/server/services/catalog";
import type { currentRates, listRates, rateForOrderDate } from "@/server/services/exchange-rates";
import type { getOrder, listOrders, quoteOrder } from "@/server/services/orders";

/**
 * Response types derived from the services themselves (type-only imports; no
 * server code reaches the browser). Json<T> mirrors JSON serialization: Dates
 * arrive as ISO strings.
 */
type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type Out<F extends (...a: never[]) => Promise<unknown>> = Json<Awaited<ReturnType<F>>>;

export type CustomerPage = Out<typeof listCustomers>;
export type CustomerRow = CustomerPage["items"][number];
export type CustomerDetailDto = Out<typeof getCustomer>;
export type ContactDto = CustomerDetailDto["contacts"][number];
export type AddressDto = CustomerDetailDto["addresses"][number];

export type EmployeePage = Out<typeof listEmployees>;
export type EmployeeRow = EmployeePage["items"][number];
export type EmployeeDetailDto = Out<typeof getEmployee>;

export type ProductPage = Out<typeof listProducts>;
export type ProductRow = ProductPage["items"][number];
export type ProductDetailDto = Out<typeof getProduct>;
export type CategoryList = Out<typeof listCategories>;
export type CategoryRow = CategoryList["items"][number];

export type RatePage = Out<typeof listRates>;

export type OrderPage = Out<typeof listOrders>;
export type OrderRow = OrderPage["items"][number];
export type OrderDetailDto = Out<typeof getOrder>;
export type OrderItemDto = OrderDetailDto["items"][number];
export type OrderQuoteDto = Out<typeof quoteOrder>;
export type CurrentRatesDto = Out<typeof currentRates>;
export type ApplicableRateDto = Out<typeof rateForOrderDate>;
