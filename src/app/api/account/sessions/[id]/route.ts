import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { revokeOwnSession } from "@/server/services/account";

/** DELETE — ends one of the caller's own sessions (another user's id is 404). */
export const DELETE = route<RouteContext<"/api/account/sessions/[id]">>(async (_req, ctx) => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await revokeOwnSession(p, await idParam(ctx.params, "id", "Session")));
});
