import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "@/server/auth/credentials";
import { logError } from "@/server/log";
import { createSession, revokeSession, SESSION_MAX_AGE_SECONDS } from "@/server/auth/sessions";

export { SESSION_MAX_AGE_SECONDS };

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
      credentials: { email: { type: "email" }, password: { type: "password" } },
      authorize: (raw) => verifyCredentials(raw),
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Only at sign-in: register a server-side session and bind the token to it.
      if (user?.id) {
        token.sub = user.id;
        token.sid = await createSession(user.id);
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
