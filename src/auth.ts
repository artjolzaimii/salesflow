import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticate } from "@/server/auth/credentials";
import { logError } from "@/server/log";
import { createSession, revokeSession, SESSION_MAX_AGE_SECONDS } from "@/server/auth/sessions";

export { SESSION_MAX_AGE_SECONDS };

/** Password accepted; the account has MFA, so a TOTP or recovery code is needed. */
export class MfaRequired extends CredentialsSignin {
  code = "mfa_required";
}
/** Password accepted, but the MFA code is wrong, used or locked out. */
export class MfaInvalid extends CredentialsSignin {
  code = "mfa_invalid";
}

const header = (req: Request | undefined, name: string) => req?.headers.get(name) ?? null;

/**
 * Auth.js (next-auth v5): email/password against the existing User table.
 *
 * Sessions are encrypted JWT cookies (httpOnly, SameSite=Lax, Secure on HTTPS)
 * that carry the user id and a server-side session id (auth_sessions). Every
 * request re-reads the user (role, active flags) and requires the session row to
 * be unrevoked and unexpired (src/server/auth/load-principal.ts), so sign-out,
 * deactivation and role changes take effect immediately, not when the cookie expires.
 *
 * There is no sign-up route: accounts are created by an administrator.
 * Requires AUTH_SECRET (server-only, see .env.example).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 15 * 60 },
  pages: { signIn: "/login", error: "/login" },
  logger: {
    // A wrong password is an expected outcome, not a server error; don't log it as one.
    error(error) {
      if ((error as { type?: string }).type === "CredentialsSignin") return;
      logError("auth", error);
    },
  },
  providers: [
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" }, code: { type: "text" } },
      async authorize(raw, request) {
        const result = await authenticate(raw);
        if (result.status === "mfa_required") throw new MfaRequired();
        if (result.status === "mfa_invalid") throw new MfaInvalid();
        if (result.status !== "ok") return null;
        // Informational, for the user's session list (not used for access decisions).
        const ip = (header(request, "x-forwarded-for")?.split(",")[0] ?? header(request, "x-real-ip") ?? "").trim().slice(0, 64) || null;
        return { id: result.user.id, email: result.user.email, userAgent: header(request, "user-agent")?.slice(0, 200) ?? null, ipAddress: ip };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Only at sign-in: register a server-side session and bind the token to it.
      if (user?.id) {
        token.sub = user.id;
        const meta = user as { userAgent?: string | null; ipAddress?: string | null };
        token.sid = await createSession(user.id, { userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null });
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      (session as { sid?: string }).sid = typeof token.sid === "string" ? token.sid : undefined;
      return session;
    },
  },
  events: {
    // Sign-out revokes this session on the server, not just the browser cookie.
    async signOut(message) {
      const sid = "token" in message ? message.token?.sid : undefined;
      if (typeof sid === "string") await revokeSession(sid);
    },
  },
});
