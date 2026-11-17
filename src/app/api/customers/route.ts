import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { createCustomer, customerListQuery, listCustomers } from "@/server/services/customers";
import { z } from "zod";

/** GET ?q&status&businessType&businessSize&city&repId&page&pageSize&sort&dir — scoped to the caller. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listCustomers(p, customerListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/** POST customer with contacts[] and addresses[] (one transaction). 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ customer: await createCustomer(p, await readJson(req, z.unknown())) }, 201);
});
