import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { createCategory, listCategories } from "@/server/services/catalog";

export const GET = route(async () => {
  const p = await requireUser();
  return json(await listCategories(p));
});

/** POST { name, parentId? } — 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ category: await createCategory(p, await readJson(req, z.unknown())) }, 201);
});
