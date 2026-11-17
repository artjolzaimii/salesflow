import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { changePassword, changePasswordSchema } from "@/server/services/account";

/** POST { currentPassword, newPassword, code? } — other sessions are revoked; this one is kept. */
export const POST = route(async (req) => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  return json(await changePassword(p, await readJson(req, changePasswordSchema)));
});
