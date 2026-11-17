import "server-only";
import { z } from "zod";
import { notFound } from "./errors";

/** Path ids are UUIDs; anything else is simply "not found". */
export async function idParam<P extends Record<string, string>>(params: Promise<P>, key: keyof P & string, what: string): Promise<string> {
  const value = (await params)[key];
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw notFound(what);
  return parsed.data;
}
