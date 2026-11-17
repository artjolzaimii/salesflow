import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { disableMfa, reauthSchema } from "@/server/services/account";

/** POST { currentPassword, code } — turns MFA off. */
export const POST = route(async (req) => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await disableMfa(p, await readJson(req, reauthSchema)));
});
