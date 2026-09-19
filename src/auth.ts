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
          select: { id: true, role: true, adminLevel: true, sessionVersion: true, accessState: true },
        });
        if (!dbUser || dbUser.accessState !== "ACTIVE") return false;
        user.dbUserId = dbUser.id;
        user.dbRole = dbUser.role;
        user.dbAdminLevel = dbUser.adminLevel;
        user.dbSessionVersion = dbUser.sessionVersion;
        return true;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      // 세션 세대는 로그인 시점에만 담는다. 재검증 때 최신 값으로 덮어쓰면
      // 이미 끊어 둔 토큰이 되살아난다.
      if (account?.provider === "google" && user) {
        token.dbUserId = user.dbUserId;
        token.role = user.dbRole;
        token.adminLevel = user.dbAdminLevel ?? "NONE";
        token.sessionVersion = user.dbSessionVersion;
      }
      if (account?.provider === "admin-login") {
        token.role = "ADMIN";
        token.dbUserId = 0;
        token.adminLevel = "ADMIN";
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role as string;
      session.user.dbUserId = token.dbUserId as number;
      session.user.adminLevel =
        (token.adminLevel as "NONE" | "SUBADMIN" | "ADMIN") ?? "NONE";
      session.user.sessionVersion = token.sessionVersion;
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
});
