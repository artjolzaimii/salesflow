"use client";

import { useState } from "react";
import { formatDate } from "@/lib/money";
import { Button } from "@/components/ui/button";

/** "17 Nov 2026 14:05" in the business time zone. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const time = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return `${formatDate(day)} ${time}`;
}

/** Short device description from a user-agent string (informational only). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /node|undici/i.test(ua) ? "API client" : "Browser";
  const os = /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export const AUDIT_LABEL: Record<string, string> = {
  USER_CREATED: "Account created",
  USER_ACTIVATED: "Account activated",
  USER_DEACTIVATED: "Account deactivated",
  ROLE_CHANGED: "Role changed",
  EMPLOYEE_LINKED: "Employee linked",
  EMPLOYEE_UNLINKED: "Employee unlinked",
  SETUP_LINK_ISSUED: "Setup link issued",
  PASSWORD_RESET_ISSUED: "Password reset link issued",
  PASSWORD_RESET_COMPLETED: "Password set from link",
  PASSWORD_CHANGED: "Password changed",
  MFA_ENABLED: "MFA turned on",
  MFA_DISABLED: "MFA turned off",
  MFA_RESET_BY_ADMIN: "MFA reset by administrator",
  RECOVERY_CODES_REGENERATED: "Recovery codes replaced",
  RECOVERY_CODE_USED: "Recovery code used",
  SESSION_REVOKED: "Session signed out",
  SESSIONS_REVOKED: "Other sessions signed out",
  SESSIONS_REVOKED_BY_ADMIN: "Sessions revoked by administrator",
};

/** A secret shown exactly once (setup/reset link, recovery codes), with a copy button. */
export function OneTimeSecret({ title, value, note, testId }: { title: string; value: string; note: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 border border-warning-800/40 bg-warning-100 px-3 py-[10px] text-warning-800" role="status">
      <span className="text-[12.5px] font-medium">{title}</span>
      <pre data-testid={testId} className="m-0 overflow-x-auto bg-bg px-2 py-[6px] font-mono text-[12.5px] whitespace-pre-wrap break-all text-text select-all">
        {value}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="text-[12.5px]"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <span className="text-[12px]">{note}</span>
      </div>
    </div>
  );
}

interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  current?: boolean;
}

export function SessionsTable({ sessions, busy, onRevoke }: { sessions: SessionRow[]; busy?: boolean; onRevoke?: (id: string) => void }) {
  if (!sessions.length) return <p className="text-muted m-0 text-[13px]">No active sessions.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table text-[13px]">
        <thead>
          <tr>
            <th>Device</th>
            <th>Signed in</th>
            <th>Expires</th>
            <th>IP</th>
            {onRevoke ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>
                {deviceLabel(s.userAgent)}
                {s.current ? <span className="tag tag-accent ml-2">This session</span> : null}
              </td>
              <td className="whitespace-nowrap">{dateTime(s.createdAt)}</td>
              <td className="whitespace-nowrap">{dateTime(s.expiresAt)}</td>
              <td className="whitespace-nowrap text-neutral-700">{s.ipAddress ?? "—"}</td>
              {onRevoke ? (
                <td className="text-right">
                  <Button variant="ghost" className="text-[12.5px]" disabled={busy} onClick={() => onRevoke(s.id)}>
                    {s.current ? "Sign out" : "Revoke"}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
