import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { deleteContact, updateContact } from "@/server/services/customers";

type Ctx = RouteContext<"/api/customers/[id]/contacts/[contactId]">;

export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  const [id, contactId] = [await idParam(ctx.params, "id", "Customer"), await idParam(ctx.params, "contactId", "Contact")];
  return json({ contact: await updateContact(p, id, contactId, await readJson(req, z.unknown())) });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  const [id, contactId] = [await idParam(ctx.params, "id", "Customer"), await idParam(ctx.params, "contactId", "Contact")];
  return json(await deleteContact(p, id, contactId));
});
