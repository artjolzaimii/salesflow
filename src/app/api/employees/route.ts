import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { createEmployee, employeeListQuery, listEmployees } from "@/server/services/employees";

/** GET ?q&active&role&page&pageSize&sort&dir (managers and admins). */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listEmployees(p, employeeListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/** POST employee, optionally with { account: { email, role, password } } (admins). 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ employee: await createEmployee(p, await readJson(req, z.unknown())) }, 201);
});
