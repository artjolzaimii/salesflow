import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listCustomers } from "@/server/services/customers";

export const GET = route(async () => {
  const p = await requireUser();
  return json({ customers: await listCustomers(p) });
});
