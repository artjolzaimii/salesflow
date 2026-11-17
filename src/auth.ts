import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "@/server/auth/credentials";

/** Absolute session lifetime. The token is refreshed at most every 15 minutes while in use. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Auth.js (next-auth v5): email/password against the existing User table.
 *
 * Sessions are encrypted JWT cookies (httpOnly, SameSite=Lax, Secure on HTTPS)
 * that carry only the user id. Role, active flag and employee link are read from
 * the database on every request (src/server/auth/session.ts), so disabling a
 * user or changing a role takes effect immediately, not when the cookie expires.
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
      console.error("[auth]", error);
    },
  },
  providers: [
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" } },
      authorize: (raw) => verifyCredentials(raw),
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
