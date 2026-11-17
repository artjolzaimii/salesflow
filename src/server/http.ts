import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppError, mapDatabaseError } from "./errors";
import { logError } from "./log";

/** Largest accepted JSON body (an order with 200 lines is well under 100 KB). */
export const MAX_BODY_BYTES = 256 * 1024;

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a Route Handler:
 * - state-changing requests must be JSON and same-origin (CSRF defence on top
 *   of the SameSite=Lax session cookie): a foreign Origin or a browser-reported
 *   cross-site request (Sec-Fetch-Site) is refused,
 * - bodies are capped at MAX_BODY_BYTES (413),
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
        if (req.headers.get("sec-fetch-site") === "cross-site") throw new AppError(403, "CROSS_ORIGIN", "Cross-origin request refused.");
        const hasBody = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
        if (hasBody && !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
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
        return json({ error: { code: "VALIDATION_FAILED", message: "Invalid request.", details: issueDetails(e) } }, 422);
      }
      logError("api", e, { method: req.method, path: req.nextUrl.pathname });
      return json({ error: { code: "INTERNAL", message: "Something went wrong." } }, 500);
    }
  };
}

/** Zod issues → { "lines.1.quantity": [messages] }: full dotted paths, so forms can mark the exact field. */
export function issueDetails(e: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of e.issues) (out[issue.path.join(".") || "_"] ??= []).push(issue.message);
  return out;
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.output<T>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new AppError(400, "BAD_JSON", "Request body could not be read.");
  }
  // Also checked after reading: Content-Length may be absent (chunked) or wrong.
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError(400, "BAD_JSON", "Request body is not valid JSON.");
  }
  return schema.parse(body);
}

export const uuidParam = z.uuid();
