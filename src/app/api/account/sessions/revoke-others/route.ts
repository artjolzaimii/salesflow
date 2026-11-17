import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { revokeOtherSessions } from "@/server/services/account";

/** POST — signs out every other session of the caller. */
export const POST = route(async () => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await revokeOtherSessions(p));
});
