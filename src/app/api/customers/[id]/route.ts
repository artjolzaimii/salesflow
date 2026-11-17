import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getCustomer, updateCustomer } from "@/server/services/customers";

type Ctx = RouteContext<"/api/customers/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ customer: await getCustomer(p, await idParam(ctx.params, "id", "Customer")) });
});

/** PATCH any subset of business fields, status, notes, assignedRepId (managers). Customers are never deleted. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Customer");
  return json({ customer: await updateCustomer(p, id, await readJson(req, z.unknown())) });
});
