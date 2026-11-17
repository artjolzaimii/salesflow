import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { deleteCategory, updateCategory } from "@/server/services/catalog";

type Ctx = RouteContext<"/api/categories/[id]">;

export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Category");
  return json({ category: await updateCategory(p, id, await readJson(req, z.unknown())) });
});

/** Only empty categories can be deleted (409 otherwise). */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  return json(await deleteCategory(p, await idParam(ctx.params, "id", "Category")));
});
