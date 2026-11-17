import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getUser, updateUser, userPatchSchema } from "@/server/services/users";

type Ctx = RouteContext<"/api/users/[id]">;

/** GET — account, live sessions, recent security events. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ user: await getUser(p, await idParam(ctx.params, "id", "User")) });
});

/** PATCH { role?, isActive?, employeeId? } — revokes sessions on role change, deactivation and relinking. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  return json({ user: await updateUser(p, await idParam(ctx.params, "id", "User"), await readJson(req, userPatchSchema)) });
});
