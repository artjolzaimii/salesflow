import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { conversationCreateSchema, conversationListQuery, createConversation, listConversations } from "@/server/services/assistant";

/** GET ?page&pageSize — the caller's own conversations, most recent first. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listConversations(p, conversationListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/** POST { title? } — starts a conversation owned by the caller. 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ conversation: await createConversation(p, await readJson(req, conversationCreateSchema)) }, 201);
});
