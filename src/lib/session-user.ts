import { ROLE_TITLES, type UserRole } from "./permissions";

/** What the browser receives about the signed-in user. No database ids. */
export interface ClientSessionUser {
  name: string;
  initials: string;
  email: string;
  role: UserRole;
  title: string;
}

export function makeClientUser(u: { name: string; email: string; role: UserRole }): ClientSessionUser {
  const initials =
    u.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || u.email[0]!.toUpperCase();
  return { name: u.name, initials, email: u.email, role: u.role, title: ROLE_TITLES[u.role] };
}
