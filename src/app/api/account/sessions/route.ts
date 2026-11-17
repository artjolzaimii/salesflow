import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listOwnSessions } from "@/server/services/account";

/** GET — the caller's live sessions; `current` marks this one. */
export const GET = route(async () => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await listOwnSessions(p));
});
