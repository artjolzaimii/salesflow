import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { enableMfa, enableMfaSchema } from "@/server/services/account";

/** POST { code } — turns MFA on after a valid code; returns recovery codes once. */
export const POST = route(async (req) => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await enableMfa(p, await readJson(req, enableMfaSchema)));
});
