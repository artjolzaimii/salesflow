import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { opsSummary } from "@/server/services/ops";

/** GET — operational summary for administrators (counts and latencies only). */
export const GET = route(async () => {
  const p = await requireUser();
  return json({ summary: await opsSummary(p) });
});
