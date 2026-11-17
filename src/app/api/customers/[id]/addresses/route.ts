import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { addAddress } from "@/server/services/customers";

export const POST = route<RouteContext<"/api/customers/[id]/addresses">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Customer");
  return json({ address: await addAddress(p, id, await readJson(req, z.unknown())) }, 201);
});
