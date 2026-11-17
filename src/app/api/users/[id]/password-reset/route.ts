import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { issuePasswordReset } from "@/server/services/users";

/** POST — a one-time password reset link (24 h, shown once); the user's sessions end now. */
export const POST = route<RouteContext<"/api/users/[id]/password-reset">>(async (req, ctx) => {
  const p = await requireUser();
  return json(await issuePasswordReset(p, await idParam(ctx.params, "id", "User"), req.nextUrl.origin), 201);
});
