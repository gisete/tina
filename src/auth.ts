import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db/client";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope: "openid profile email https://www.googleapis.com/auth/googlehealth.sleep.readonly https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
