import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { createUser, listUsers, userCreateSchema, userListQuery } from "@/server/services/users";

/** GET ?q&role&active&mfa&page&pageSize&sort&dir — administrators only (users.manage). */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listUsers(p, userListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/** POST { email, role, employeeId? } — creates the account; 201 with a one-time setup link (shown once, never stored in clear). */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json(await createUser(p, await readJson(req, userCreateSchema), req.nextUrl.origin), 201);
});
