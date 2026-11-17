"use client";

import { createContext, use, type ReactNode } from "react";
import type { ClientSessionUser } from "@/lib/session-user";

const SessionContext = createContext<ClientSessionUser | null>(null);

/**
 * The signed-in user, resolved on the server for this request by the (app)
 * layout. Client components read it for display only; the server re-checks
 * every permission.
 */
export function SessionProvider({ user, children }: { user: ClientSessionUser; children: ReactNode }) {
  return <SessionContext value={user}>{children}</SessionContext>;
}

export function useSessionUser(): ClientSessionUser {
  const user = use(SessionContext);
  if (!user) throw new Error("useSessionUser must be used inside the signed-in app layout.");
  return user;
}
