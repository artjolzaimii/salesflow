import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { resetUserMfa } from "@/server/services/users";

/** POST — turns MFA off for a user who lost their authenticator; recovery codes deleted, sessions revoked. */
export const POST = route<RouteContext<"/api/users/[id]/mfa/reset">>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ user: await resetUserMfa(p, await idParam(ctx.params, "id", "User")) });
});
