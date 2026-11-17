import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { messageSchema, sendMessage } from "@/server/services/assistant";

/**
 * POST { content } — asks a question. The model runs server-side with read-only,
 * permission-checked tools; 200 with the saved user and assistant messages.
 * 429 ASSISTANT_RATE_LIMITED, 409 ASSISTANT_BUSY, 503 ASSISTANT_NOT_CONFIGURED /
 * ASSISTANT_UNAVAILABLE, 504 ASSISTANT_TIMEOUT (the question and an error note are saved).
 */
export const POST = route<RouteContext<"/api/assistant/conversations/[id]/messages">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Conversation");
  return json(await sendMessage(p, id, await readJson(req, messageSchema)));
});
