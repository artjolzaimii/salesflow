import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { deleteAddress, updateAddress } from "@/server/services/customers";

type Ctx = RouteContext<"/api/customers/[id]/addresses/[addressId]">;

export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  const [id, addressId] = [await idParam(ctx.params, "id", "Customer"), await idParam(ctx.params, "addressId", "Address")];
  return json({ address: await updateAddress(p, id, addressId, await readJson(req, z.unknown())) });
});

/** Refused (409) for the default address or one that orders were delivered to. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  const [id, addressId] = [await idParam(ctx.params, "id", "Customer"), await idParam(ctx.params, "addressId", "Address")];
  return json(await deleteAddress(p, id, addressId));
});
