import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 365, // 365 days
    updateAge: 60 * 60 * 24, // rolling refresh once per day
  },
  jwt: {
    maxAge: 60 * 60 * 24 * 365, // 365 days
  },
  providers: [
    Google,
    Credentials({
      id: "admin-login",
      name: "Admin",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        if (
          credentials.username !== ADMIN_USERNAME ||
          credentials.password !== ADMIN_PASSWORD
        ) {
          return null;
        }

        return {
          id: "admin-1",
          name: ADMIN_USERNAME,
          email: "admin@posanmeal.local",
          role: "ADMIN" as const,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true },
        });
        if (!dbUser) return false;
        (user as any).dbUserId = dbUser.id;
        (user as any).dbRole = dbUser.role;
        return true;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user) {
        token.dbUserId = (user as any).dbUserId;
        token.role = (user as any).dbRole;
      }
      if (account?.provider === "admin-login") {
        token.role = "ADMIN";
        token.dbUserId = 0;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role as string;
      session.user.dbUserId = token.dbUserId as number;
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
});
