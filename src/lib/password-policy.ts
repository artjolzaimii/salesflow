/**
 * Password policy, shared by the forms (immediate feedback) and the server
 * (authoritative). Follows NIST SP 800-63B: length over composition rules,
 * plus a check against very common and context-specific passwords.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

const COMMON = new Set([
  "password1234",
  "passwordpassword",
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwertyuiopasdf",
  "iloveyou1234",
  "welcome12345",
  "letmein12345",
  "administrator",
  "changeme1234",
  "salesflow123",
  "salesflow2026",
  "admin1234567",
  "abcdefghijkl",
  "111111111111",
  "000000000000",
]);

/** Returns a message when the password is not acceptable, else null. */
export function passwordProblem(password: string, context: { email?: string | null; names?: string[] } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "This password is too common. Choose another.";
  if (/^(.)\1+$/.test(password)) return "Don't repeat a single character.";
  if (new Set(password).size < 5) return "Use more varied characters.";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Don't include your email address.";
  for (const n of context.names ?? []) if (n.length >= 4 && lower.includes(n.toLowerCase())) return "Don't include your name.";
  if (lower.includes("salesflow")) return "Don't include the application name.";
  return null;
}
