import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { adminRevokeSessions } from "@/server/services/users";

/** POST { sessionId? } — ends one session, or every session of the user. */
export const POST = route<RouteContext<"/api/users/[id]/sessions/revoke">>(async (req, ctx) => {
  const p = await requireUser();
  const { sessionId } = await readJson(req, z.strictObject({ sessionId: z.uuid().optional() }));
  return json(await adminRevokeSessions(p, await idParam(ctx.params, "id", "User"), sessionId));
});
