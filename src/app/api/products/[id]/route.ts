import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getProduct, updateProduct } from "@/server/services/catalog";

type Ctx = RouteContext<"/api/products/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ product: await getProduct(p, await idParam(ctx.params, "id", "Product")) });
});

/** PATCH any field, including isActive (deactivate instead of delete). */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Product");
  return json({ product: await updateProduct(p, id, await readJson(req, z.unknown())) });
});
