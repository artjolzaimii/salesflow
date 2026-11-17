import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { startMfaSetup, reauthSchema } from "@/server/services/account";

/** POST { currentPassword, code? } — starts setup; the secret and QR are returned only now, before MFA is on. */
export const POST = route(async (req) => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await startMfaSetup(p, await readJson(req, reauthSchema)));
});
