/**
 * Process lifecycle state shared by the instrumentation hook and the health
 * endpoint. On SIGTERM/SIGINT `next start` stops accepting connections and
 * finishes in-flight requests; meanwhile /api/health answers 503 so a load
 * balancer stops routing new traffic here at once.
 */
const state = globalThis as unknown as { salesflowShuttingDown?: boolean; salesflowStartedAt?: number };

export function markShuttingDown() {
  state.salesflowShuttingDown = true;
}

export const isShuttingDown = () => state.salesflowShuttingDown === true;

export function markStarted() {
  state.salesflowStartedAt ??= Date.now();
}

/** For tests only. */
export function resetLifecycle() {
  state.salesflowShuttingDown = false;
}
