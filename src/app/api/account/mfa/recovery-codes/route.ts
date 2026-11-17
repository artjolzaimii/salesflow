import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { regenerateRecoveryCodes, reauthSchema } from "@/server/services/account";

/** POST { currentPassword, code } — new recovery codes (shown once); the old ones stop working. */
export const POST = route(async (req) => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await regenerateRecoveryCodes(p, await readJson(req, reauthSchema)));
});
