import { checkConfig } from "./server/config-check";
import { markShuttingDown, markStarted } from "./server/lifecycle";
import { logError } from "./server/log";

/**
 * Node.js-only startup work, imported by src/instrumentation.ts when
 * NEXT_RUNTIME is "nodejs" (keeps Node APIs out of the Edge bundle).
 */
export function registerNode() {
  markStarted();

  if (process.env.NODE_ENV === "production") {
    const { errors, warnings } = checkConfig(process.env);
    for (const w of warnings) console.warn(JSON.stringify({ level: "warn", event: "config_warning", message: w }));
    if (errors.length) {
      for (const e of errors) console.error(JSON.stringify({ level: "error", event: "config_error", message: e }));
      if (process.env.SALESFLOW_CONFIG_CHECK !== "warn") {
        // Next.js would catch a thrown error and keep answering 500, so stop the process instead
        // (scripts/preflight.mjs normally catches this before `next start`).
        console.error(`SalesFlow configuration is not production-ready (${errors.length} problem(s)); stopping.`);
        process.exit(1);
      }
    }
  }

  // `next start` drains in-flight requests on these signals; meanwhile /api/health answers 503.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      markShuttingDown();
      console.info(JSON.stringify({ level: "info", event: "shutdown_started", signal, ts: new Date().toISOString() }));
    });
  }
}

export function reportRequestError(err: unknown, path: string, method: string, routeType: string) {
  logError("next", err, { path: path.split("?")[0], method, routeType });
}
