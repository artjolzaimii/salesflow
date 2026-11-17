import type { Instrumentation } from "next";

/**
 * Runs once per server instance before it takes traffic. Node.js work lives in
 * instrumentation-node.ts (configuration check, shutdown marker, error logging)
 * and is imported only in the Node.js runtime, so the Edge bundle stays free of
 * Node APIs. Next.js itself performs the graceful shutdown on SIGTERM/SIGINT.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    registerNode();
  }
}

/** Server errors caught by Next.js (rendering, route handlers outside our wrapper), logged without secrets. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("./instrumentation-node");
  reportRequestError(err, request.path, request.method, context.routeType);
};
