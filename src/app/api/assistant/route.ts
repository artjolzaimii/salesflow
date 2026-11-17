import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { assistantStatus } from "@/server/services/assistant";

/** GET — whether the assistant is configured on this server, and its limits (never any credential). */
export const GET = route(async () => {
  const p = await requireUser();
  return json(assistantStatus(p));
});
