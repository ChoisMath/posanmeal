import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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

        const admin = await prisma.admin.findUnique({
          where: { username: credentials.username as string },
        });

        if (!admin) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          admin.passwordHash
        );

        if (!isValid) return null;

        return {
          id: `admin-${admin.id}`,
          name: admin.username,
          email: `admin-${admin.id}@posanmeal.local`,
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
        });
        if (!dbUser) return false;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
        });
        if (dbUser) {
          token.dbUserId = dbUser.id;
          token.role = dbUser.role;
        }
      }
      if (account?.provider === "admin-login" && user) {
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
