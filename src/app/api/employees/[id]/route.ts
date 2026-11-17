import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getEmployee, updateEmployee } from "@/server/services/employees";

type Ctx = RouteContext<"/api/employees/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ employee: await getEmployee(p, await idParam(ctx.params, "id", "Employee")) });
});

/** PATCH names, phone, territory, isActive (+ reassignCustomersTo when deactivating). */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Employee");
  return json({ employee: await updateEmployee(p, id, await readJson(req, z.unknown())) });
});
