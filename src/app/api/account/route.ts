import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { getAccount } from "@/server/services/account";

/** GET — the caller's account security status (never the MFA secret or recovery codes). */
export const GET = route(async () => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json({ account: await getAccount(p) });
});
