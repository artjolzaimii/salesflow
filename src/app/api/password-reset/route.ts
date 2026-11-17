import { json, readJson, route } from "@/server/http";
import { completePasswordReset, resetCompletionSchema } from "@/server/services/users";

/**
 * POST { token, newPassword } — completes an account-setup or password-reset
 * link. No session needed: the 256-bit single-use token is the credential.
 * 410 RESET_LINK_INVALID for unknown, used or expired links.
 */
export const POST = route(async (req) => {
  return json(await completePasswordReset(await readJson(req, resetCompletionSchema)));
});
