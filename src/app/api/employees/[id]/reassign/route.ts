import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { reassignCustomers } from "@/server/services/employees";

/** POST { toEmployeeId, customerIds? } — moves customers; past orders keep their rep. */
export const POST = route<RouteContext<"/api/employees/[id]/reassign">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Employee");
  return json(await reassignCustomers(p, id, await readJson(req, z.unknown())));
});
