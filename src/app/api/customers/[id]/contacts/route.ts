import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { addContact } from "@/server/services/customers";

export const POST = route<RouteContext<"/api/customers/[id]/contacts">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Customer");
  return json({ contact: await addContact(p, id, await readJson(req, z.unknown())) }, 201);
});
