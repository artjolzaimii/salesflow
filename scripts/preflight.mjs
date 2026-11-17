// Production preflight: validates configuration before `next start` and exits
// non-zero on errors, so a misconfigured release never takes traffic
// (docs/deployment.md). Runs with plain Node 24 (type stripping), no build step:
//   node scripts/preflight.mjs && next start
// SALESFLOW_CONFIG_CHECK=warn reports the same problems without failing.
import { checkConfig } from "../src/server/config-check.ts";

const { errors, warnings } = checkConfig(process.env);
for (const message of warnings) console.warn(JSON.stringify({ level: "warn", event: "config_warning", message }));
for (const message of errors) console.error(JSON.stringify({ level: "error", event: "config_error", message }));
if (errors.length && process.env.SALESFLOW_CONFIG_CHECK !== "warn") {
  console.error(`SalesFlow configuration is not production-ready (${errors.length} problem(s)); refusing to start.`);
  process.exit(1);
}
console.info(JSON.stringify({ level: "info", event: "config_ok", warnings: warnings.length }));
