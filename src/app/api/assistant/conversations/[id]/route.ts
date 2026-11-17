import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getConversation } from "@/server/services/assistant";

/** GET — one of the caller's conversations with its messages in order (anyone else's is 404). */
export const GET = route<RouteContext<"/api/assistant/conversations/[id]">>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ conversation: await getConversation(p, await idParam(ctx.params, "id", "Conversation")) });
});
