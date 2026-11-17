import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppError, mapDatabaseError } from "./errors";

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a Route Handler:
 * - state-changing requests must be JSON and same-origin (CSRF defence on top
 *   of the SameSite=Lax session cookie),
 * - AppError → its status and code; Zod errors → 422; guard-trigger errors →
 *   mapped codes; anything else → 500 without internal details.
 * Authentication and authorization happen inside the handler via the services.
 */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    // Authenticated responses are per request: never prerender them at build time.
    await connection();
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && origin !== req.nextUrl.origin) throw new AppError(403, "CROSS_ORIGIN", "Cross-origin request refused.");
        if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Send application/json.");
        }
      }
      const res = await handler(req, ctx);
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (raw) {
      unstable_rethrow(raw); // let Next.js control-flow errors (redirect, prerender bailout) through
      const e = mapDatabaseError(raw);
      if (e instanceof AppError) return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
      if (e instanceof z.ZodError) {
        return json({ error: { code: "VALIDATION_FAILED", message: "Invalid request.", details: z.flattenError(e).fieldErrors } }, 422);
      }
      console.error("[api] unhandled error", e);
      return json({ error: { code: "INTERNAL", message: "Something went wrong." } }, 500);
    }
  };
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "BAD_JSON", "Request body is not valid JSON.");
  }
  return schema.parse(body);
}

export const uuidParam = z.uuid();
