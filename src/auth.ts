import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

export const { handlers, signIn, signOut, auth } = NextAuth({
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
        const count = await prisma.user.count({ where: { email: user.email! } });
        return count > 0;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, role: true },
        });
        if (dbUser) {
          token.dbUserId = dbUser.id;
          token.role = dbUser.role;
        }
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
