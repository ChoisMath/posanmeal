# Posanmeal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a school dinner (석식) management web app with QR check-in for students/teachers, Google OAuth authentication, and an admin dashboard.

**Architecture:** Next.js 14+ App Router full-stack app. PostgreSQL via Prisma ORM for data. Auth.js v5 (NextAuth) for Google OAuth + admin credentials. JWT-based QR tokens with 3-minute expiry. Railway single-service deployment.

**Tech Stack:** Next.js 14, TypeScript, Prisma, Auth.js v5, Tailwind CSS, shadcn/ui, next-themes, qrcode, html5-qrcode, sharp, exceljs, jsonwebtoken, bcryptjs

**Design Spec:** `docs/superpowers/specs/2026-03-28-posanmeal-design.md`

---

## File Structure

```
posanmeal/
├── prisma/
│   └── schema.prisma                          # DB schema (Admin, User, MealPeriod, CheckIn)
├── src/
│   ├── auth.ts                                # Auth.js config (Google + Credentials)
│   ├── middleware.ts                           # Route protection middleware
│   ├── app/
│   │   ├── globals.css                        # Tailwind base + theme variables
│   │   ├── layout.tsx                         # Root layout (providers)
│   │   ├── page.tsx                           # Landing page (Google login)
│   │   ├── student/
│   │   │   └── page.tsx                       # Student main (3 tabs)
│   │   ├── teacher/
│   │   │   └── page.tsx                       # Teacher main (3-4 tabs)
│   │   ├── check/
│   │   │   └── page.tsx                       # QR scan page (public)
│   │   ├── admin/
│   │   │   ├── login/page.tsx                 # Admin login
│   │   │   └── page.tsx                       # Admin dashboard
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts    # Auth.js route handler
│   │       ├── checkin/route.ts               # QR check-in processing
│   │       ├── qr/token/route.ts              # QR JWT token generation
│   │       ├── users/me/route.ts              # User profile CRUD
│   │       ├── users/me/photo/route.ts        # Photo upload/delete
│   │       ├── checkins/route.ts              # Check-in history (monthly)
│   │       ├── teacher/students/route.ts      # Homeroom student list
│   │       └── admin/
│   │           ├── import/route.ts            # Spreadsheet CSV import
│   │           ├── users/route.ts             # User CRUD (admin)
│   │           ├── meal-periods/route.ts      # Meal period management
│   │           ├── dashboard/route.ts         # Dashboard stats
│   │           └── export/route.ts            # Excel export
│   ├── components/
│   │   ├── ui/                                # shadcn/ui components
│   │   ├── ThemeToggle.tsx                    # Dark/light mode toggle
│   │   ├── QRGenerator.tsx                    # QR code display with countdown
│   │   ├── QRScanner.tsx                      # Camera-based QR scanner
│   │   ├── MonthlyCalendar.tsx                # Monthly check-in calendar
│   │   ├── PhotoUpload.tsx                    # Photo upload component
│   │   └── StudentTable.tsx                   # Student list table
│   ├── lib/
│   │   ├── prisma.ts                          # Prisma client singleton
│   │   ├── qr-token.ts                        # QR JWT sign/verify
│   │   └── timezone.ts                        # Asia/Seoul helpers
│   └── providers/
│       ├── AuthProvider.tsx                    # SessionProvider wrapper
│       └── ThemeProvider.tsx                   # next-themes wrapper
├── .env.example                               # Environment variable template
├── .gitignore
├── docker-compose.yml                         # Local PostgreSQL
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Task 1: Project Initialization

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.gitignore`, `.env.example`, `docker-compose.yml`

- [ ] **Step 1: Create Next.js project**

Run:
```bash
cd /workspaces/posanmeal
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack
```

When prompted about overwriting README.md, select Yes.
Expected: Project scaffolded with `src/app/` directory structure.

- [ ] **Step 2: Install core dependencies**

Run:
```bash
npm install prisma @prisma/client next-auth@beta @auth/prisma-adapter next-themes jsonwebtoken bcryptjs qrcode html5-qrcode sharp exceljs clsx tailwind-merge class-variance-authority lucide-react
npm install -D @types/jsonwebtoken @types/bcryptjs @types/qrcode
```

- [ ] **Step 3: Initialize shadcn/ui**

Run:
```bash
npx shadcn@latest init -d
```

Then install required components:
```bash
npx shadcn@latest add button card input label tabs dialog table badge select separator avatar dropdown-menu toast
```

- [ ] **Step 4: Create docker-compose.yml for local PostgreSQL**

Create `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: posanmeal
      POSTGRES_PASSWORD: posanmeal
      POSTGRES_DB: posanmeal
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 5: Create .env.example**

Create `.env.example`:
```env
# Database
DATABASE_URL="postgresql://posanmeal:posanmeal@localhost:5432/posanmeal"

# Auth.js
AUTH_SECRET="generate-with-npx-auth-secret"
AUTH_GOOGLE_ID="your-google-client-id"
AUTH_GOOGLE_SECRET="your-google-client-secret"

# Admin
ADMIN_USERNAME="admin"
ADMIN_PASSWORD_HASH="$2a$10$..."

# QR Token
QR_JWT_SECRET="generate-a-random-secret"
QR_TOKEN_EXPIRY_SECONDS=180

# File Upload
UPLOAD_DIR="./public/uploads"
MAX_FILE_SIZE_MB=5

# Timezone
TZ="Asia/Seoul"
```

- [ ] **Step 6: Create .env from example**

Run:
```bash
cp .env.example .env
```

Edit `.env` to set `DATABASE_URL="postgresql://posanmeal:posanmeal@localhost:5432/posanmeal"` and generate secrets:
```bash
npx auth secret
```

- [ ] **Step 7: Update .gitignore**

Append to `.gitignore`:
```
.env
.env.local
public/uploads/*
!public/uploads/.gitkeep
.superpowers/
```

Run:
```bash
mkdir -p public/uploads && touch public/uploads/.gitkeep
```

- [ ] **Step 8: Update next.config.ts**

Replace `next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [],
  },
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: initialize Next.js project with dependencies and config"
```

---

## Task 2: Prisma Schema and Database Setup

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/prisma.ts`

- [ ] **Step 1: Initialize Prisma**

Run:
```bash
npx prisma init
```

- [ ] **Step 2: Write Prisma schema**

Replace `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  STUDENT
  TEACHER
}

enum CheckInType {
  STUDENT
  WORK
  PERSONAL
}

model Admin {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  role      Role
  grade     Int?
  classNum  Int?
  number    Int?
  subject   String?
  homeroom  String?
  position  String?
  photoUrl  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  mealPeriod MealPeriod?
  checkIns   CheckIn[]
}

model MealPeriod {
  id        Int      @id @default(autoincrement())
  userId    Int      @unique
  startDate DateTime @db.Date
  endDate   DateTime @db.Date
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model CheckIn {
  id        Int         @id @default(autoincrement())
  userId    Int
  date      DateTime    @db.Date
  checkedAt DateTime    @default(now())
  type      CheckInType

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, date])
}
```

- [ ] **Step 3: Create Prisma client singleton**

Create `src/lib/prisma.ts`:
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Run migration**

Run:
```bash
docker compose up -d
npx prisma migrate dev --name init
```

Expected: Migration applied, `@prisma/client` generated.

- [ ] **Step 5: Seed admin user**

Create `prisma/seed.ts`:
```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin1234", 10);
  await prisma.admin.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
    },
  });
  console.log("Admin user seeded");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
```

Add to `package.json`:
```json
{
  "prisma": {
    "seed": "npx tsx prisma/seed.ts"
  }
}
```

Run:
```bash
npm install -D tsx
npx prisma db seed
```

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/lib/prisma.ts package.json
git commit -m "feat: add Prisma schema with Admin, User, MealPeriod, CheckIn models"
```

---

## Task 3: Core Utilities (timezone, QR token)

**Files:**
- Create: `src/lib/timezone.ts`, `src/lib/qr-token.ts`

- [ ] **Step 1: Create timezone utility**

Create `src/lib/timezone.ts`:
```typescript
export const TIMEZONE = "Asia/Seoul";

export function nowKST(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

export function todayKST(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

export function formatKST(date: Date): string {
  return date.toLocaleString("ko-KR", { timeZone: TIMEZONE });
}

export function formatDateKST(date: Date): string {
  return date.toLocaleDateString("ko-KR", {
    timeZone: TIMEZONE,
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatTimeKST(date: Date): string {
  return date.toLocaleTimeString("ko-KR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
```

- [ ] **Step 2: Create QR token utility**

Create `src/lib/qr-token.ts`:
```typescript
import jwt from "jsonwebtoken";

const QR_SECRET = process.env.QR_JWT_SECRET!;
const EXPIRY_SECONDS = parseInt(
  process.env.QR_TOKEN_EXPIRY_SECONDS || "180",
  10
);

export interface QRTokenPayload {
  userId: number;
  role: "STUDENT" | "TEACHER";
  type: "STUDENT" | "WORK" | "PERSONAL";
}

export function signQRToken(payload: QRTokenPayload): string {
  return jwt.sign(payload, QR_SECRET, { expiresIn: EXPIRY_SECONDS });
}

export function verifyQRToken(token: string): QRTokenPayload {
  return jwt.verify(token, QR_SECRET) as QRTokenPayload;
}

export function getQRExpirySeconds(): number {
  return EXPIRY_SECONDS;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/timezone.ts src/lib/qr-token.ts
git commit -m "feat: add timezone and QR token utilities"
```

---

## Task 4: Auth.js Configuration (Google OAuth + Admin Credentials)

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create Auth.js configuration**

Create `src/auth.ts`:
```typescript
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
```

- [ ] **Step 2: Extend Auth.js types**

Create `src/types/next-auth.d.ts`:
```typescript
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string;
      role: string;
      dbUserId: number;
    };
  }

  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    dbUserId?: number;
  }
}
```

- [ ] **Step 3: Create route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Commit**

```bash
git add src/auth.ts src/types/next-auth.d.ts src/app/api/auth/
git commit -m "feat: configure Auth.js with Google OAuth and admin credentials"
```

---

## Task 5: Middleware (Route Protection)

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create middleware**

Create `src/middleware.ts`:
```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Public routes - no auth needed
  if (
    pathname === "/" ||
    pathname === "/check" ||
    pathname === "/admin/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/checkin") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/uploads")
  ) {
    return NextResponse.next();
  }

  // No session - redirect to login
  if (!session) {
    if (pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Role-based access
  const role = session.user?.role;

  if (pathname.startsWith("/student") && role !== "STUDENT") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (pathname.startsWith("/teacher") && role !== "TEACHER") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (
    pathname.startsWith("/admin") &&
    !pathname.startsWith("/admin/login") &&
    role !== "ADMIN"
  ) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  // API route protection
  if (pathname.startsWith("/api/admin") && role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (pathname.startsWith("/api/teacher") && role !== "TEACHER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add route protection middleware"
```

---

## Task 6: Theme Provider and Auth Provider

**Files:**
- Create: `src/providers/ThemeProvider.tsx`, `src/providers/AuthProvider.tsx`, `src/components/ThemeToggle.tsx`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`

- [ ] **Step 1: Create ThemeProvider**

Create `src/providers/ThemeProvider.tsx`:
```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 2: Create AuthProvider**

Create `src/providers/AuthProvider.tsx`:
```tsx
"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";

export function AuthProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

- [ ] **Step 3: Create ThemeToggle component**

Create `src/components/ThemeToggle.tsx`:
```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <Button variant="ghost" size="icon" disabled />;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </Button>
  );
}
```

- [ ] **Step 4: Update root layout**

Replace `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "포산밀 - 석식 관리",
  description: "포산고등학교 석식 관리 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify dev server starts**

Run:
```bash
npm run dev
```

Expected: Server starts at http://localhost:3000 without errors.

- [ ] **Step 6: Commit**

```bash
git add src/providers/ src/components/ThemeToggle.tsx src/app/layout.tsx src/app/globals.css
git commit -m "feat: add theme and auth providers with dark/light toggle"
```

---

## Task 7: Landing Page (Google Login)

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create landing page**

Replace `src/app/page.tsx`:
```tsx
import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    const role = session.user.role;
    if (role === "STUDENT") redirect("/student");
    if (role === "TEACHER") redirect("/teacher");
    if (role === "ADMIN") redirect("/admin");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">포산밀</CardTitle>
          <p className="text-muted-foreground">포산고등학교 석식 관리 시스템</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit" className="w-full" size="lg">
              Google로 로그인
            </Button>
          </form>
          <div className="text-center">
            <a
              href="/admin/login"
              className="text-sm text-muted-foreground hover:underline"
            >
              관리자 로그인
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: create landing page with Google login"
```

---

## Task 8: Admin Login Page

**Files:**
- Create: `src/app/admin/login/page.tsx`

- [ ] **Step 1: Create admin login page**

Create `src/app/admin/login/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("admin-login", {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    } else {
      router.push("/admin");
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-bold">관리자 로그인</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">아이디</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/login/
git commit -m "feat: create admin login page"
```

---

## Task 9: QR Token API and QR Generator Component

**Files:**
- Create: `src/app/api/qr/token/route.ts`, `src/components/QRGenerator.tsx`

- [ ] **Step 1: Create QR token API**

Create `src/app/api/qr/token/route.ts`:
```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { signQRToken, getQRExpirySeconds } from "@/lib/qr-token";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "STUDENT";

  const userId = session.user.dbUserId;
  const role = session.user.role as "STUDENT" | "TEACHER";

  // For students, check meal period
  if (role === "STUDENT") {
    const today = todayKST();
    const mealPeriod = await prisma.mealPeriod.findUnique({
      where: { userId },
    });

    if (!mealPeriod) {
      return NextResponse.json(
        { error: "석식 신청 기간이 없습니다." },
        { status: 400 }
      );
    }

    const todayDate = new Date(today);
    if (todayDate < mealPeriod.startDate || todayDate > mealPeriod.endDate) {
      return NextResponse.json(
        { error: "현재 석식 신청 기간이 아닙니다." },
        { status: 400 }
      );
    }
  }

  const validType = role === "STUDENT" ? "STUDENT" : (type as "WORK" | "PERSONAL");

  const token = signQRToken({
    userId,
    role,
    type: validType,
  });

  return NextResponse.json({
    token,
    expiresIn: getQRExpirySeconds(),
  });
}
```

- [ ] **Step 2: Create QR Generator component**

Create `src/components/QRGenerator.tsx`:
```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";

interface QRGeneratorProps {
  type: "STUDENT" | "WORK" | "PERSONAL";
}

export function QRGenerator({ type }: QRGeneratorProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [error, setError] = useState<string>("");

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch(`/api/qr/token?type=${type}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "QR 코드를 생성할 수 없습니다.");
        setQrDataUrl("");
        return;
      }

      setError("");
      const dataUrl = await QRCode.toDataURL(data.token, {
        width: 280,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      setQrDataUrl(dataUrl);
      setTimeLeft(data.expiresIn);
    } catch {
      setError("QR 코드 생성 중 오류가 발생했습니다.");
    }
  }, [type]);

  useEffect(() => {
    fetchToken();
  }, [fetchToken]);

  useEffect(() => {
    if (timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          fetchToken();
          return 0;
        }
        // Auto-refresh 30 seconds before expiry
        if (prev === 30) {
          fetchToken();
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, fetchToken]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="QR Code"
          className="w-[280px] h-[280px] rounded-xl border"
        />
      ) : (
        <div className="w-[280px] h-[280px] rounded-xl border flex items-center justify-center">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      )}
      <p className="text-sm font-mono text-muted-foreground">
        {minutes}:{seconds.toString().padStart(2, "0")} 남음
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/qr/ src/components/QRGenerator.tsx
git commit -m "feat: add QR token API and QR generator component with countdown"
```

---

## Task 10: Check-in API

**Files:**
- Create: `src/app/api/checkin/route.ts`

- [ ] **Step 1: Create check-in API**

Create `src/app/api/checkin/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { verifyQRToken } from "@/lib/qr-token";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: "토큰이 없습니다." },
        { status: 400 }
      );
    }

    let payload;
    try {
      payload = verifyQRToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: "QR이 만료되었습니다. 새로고침 해주세요." },
        { status: 400 }
      );
    }

    const today = todayKST();
    const todayDate = new Date(today);

    // For students, check meal period
    if (payload.role === "STUDENT") {
      const mealPeriod = await prisma.mealPeriod.findUnique({
        where: { userId: payload.userId },
      });

      if (!mealPeriod) {
        return NextResponse.json(
          { success: false, error: "석식 신청 기간이 없습니다." },
          { status: 400 }
        );
      }

      if (todayDate < mealPeriod.startDate || todayDate > mealPeriod.endDate) {
        return NextResponse.json(
          { success: false, error: "석식 신청 기간이 아닙니다." },
          { status: 400 }
        );
      }
    }

    // Check duplicate
    const existing = await prisma.checkIn.findUnique({
      where: {
        userId_date: {
          userId: payload.userId,
          date: todayDate,
        },
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        role: true,
        grade: true,
        classNum: true,
        number: true,
        photoUrl: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existing) {
      return NextResponse.json({
        success: false,
        duplicate: true,
        user,
        error: "이미 Checkin 되었습니다. 확인해 주세요.",
      });
    }

    // Create check-in
    const checkIn = await prisma.checkIn.create({
      data: {
        userId: payload.userId,
        date: todayDate,
        type: payload.type,
      },
    });

    return NextResponse.json({
      success: true,
      user,
      type: payload.type,
      checkedAt: checkIn.checkedAt,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/checkin/
git commit -m "feat: add check-in API with duplicate detection and meal period validation"
```

---

## Task 11: QR Scanner Component and Check Page

**Files:**
- Create: `src/components/QRScanner.tsx`, `src/app/check/page.tsx`

- [ ] **Step 1: Create QR Scanner component**

Create `src/components/QRScanner.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  onScan: (data: string) => void;
  scanning: boolean;
}

export function QRScanner({ onScan, scanning }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<string>("qr-reader");

  useEffect(() => {
    if (!scanning) return;

    const scanner = new Html5Qrcode(containerRef.current);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          onScan(decodedText);
        },
        () => {}
      )
      .catch((err) => {
        console.error("QR Scanner error:", err);
      });

    return () => {
      scanner
        .stop()
        .catch(() => {});
    };
  }, [scanning, onScan]);

  return (
    <div
      id={containerRef.current}
      className="w-full max-w-md mx-auto rounded-lg overflow-hidden"
    />
  );
}
```

- [ ] **Step 2: Create Check page**

Create `src/app/check/page.tsx`:
```tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { QRScanner } from "@/components/QRScanner";
import { ThemeToggle } from "@/components/ThemeToggle";

interface CheckInResult {
  success: boolean;
  duplicate?: boolean;
  error?: string;
  user?: {
    id: number;
    name: string;
    role: string;
    grade?: number;
    classNum?: number;
    number?: number;
    photoUrl?: string;
  };
  type?: string;
  checkedAt?: string;
}

export default function CheckPage() {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [processing, setProcessing] = useState(false);

  const resetAfterDelay = useCallback(() => {
    setTimeout(() => {
      setResult(null);
      setScanning(true);
    }, 2000);
  }, []);

  const handleScan = useCallback(
    async (data: string) => {
      if (processing) return;
      setProcessing(true);
      setScanning(false);

      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: data }),
        });
        const json = await res.json();
        setResult(json);
      } catch {
        setResult({ success: false, error: "서버 연결 오류" });
      }

      setProcessing(false);
      resetAfterDelay();
    },
    [processing, resetAfterDelay]
  );

  // Format date/time for display
  const formatCheckedAt = (checkedAt: string) => {
    const d = new Date(checkedAt);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${month}월 ${day}일 ${hour}:${minute}시`;
  };

  const typeLabel = (type?: string) => {
    if (type === "WORK") return "근무";
    if (type === "PERSONAL") return "개인";
    return "";
  };

  const bgClass = result
    ? result.duplicate
      ? "bg-red-500"
      : result.success
        ? "bg-green-500"
        : "bg-yellow-500"
    : "bg-background";

  return (
    <div className={`min-h-screen transition-colors duration-300 ${bgClass}`}>
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Camera Area */}
      <div className="bg-gray-900 p-4">
        <div className="max-w-md mx-auto">
          <QRScanner onScan={handleScan} scanning={scanning} />
          {!scanning && !result && (
            <div className="flex items-center justify-center h-64 text-white">
              처리 중...
            </div>
          )}
        </div>
      </div>

      {/* Result Area */}
      <div className="p-6 max-w-md mx-auto">
        {result && (
          <div className="flex items-center gap-4 bg-white/90 dark:bg-gray-800/90 rounded-xl p-4">
            {result.user?.photoUrl ? (
              <img
                src={result.user.photoUrl}
                alt={result.user.name}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xl font-bold">
                {result.user?.name?.charAt(0) || "?"}
              </div>
            )}
            <div>
              {result.user?.role === "STUDENT" ? (
                <p className="font-bold text-lg text-gray-900 dark:text-white">
                  {result.user.grade}-{result.user.classNum}{" "}
                  {result.user.number}번 {result.user.name}
                </p>
              ) : (
                <p className="font-bold text-lg text-gray-900 dark:text-white">
                  {result.user?.name} 선생님
                </p>
              )}

              {result.success && (
                <p className="text-green-700 dark:text-green-300 text-sm mt-1">
                  {result.user?.role === "TEACHER" && result.checkedAt
                    ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 석식 체크인 되었습니다.`
                    : "석식 체크인 되었습니다."}
                </p>
              )}

              {result.duplicate && (
                <p className="text-red-700 dark:text-red-300 text-sm mt-1 font-semibold">
                  이미 Checkin 되었습니다. 확인해 주세요.
                </p>
              )}

              {!result.success && !result.duplicate && (
                <p className="text-yellow-700 dark:text-yellow-300 text-sm mt-1">
                  {result.error}
                </p>
              )}
            </div>
          </div>
        )}

        {!result && (
          <div className="text-center text-muted-foreground">
            <p className="text-lg font-semibold">QR 코드를 스캔해 주세요</p>
            <p className="text-sm mt-1">카메라에 QR 코드를 보여주세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/QRScanner.tsx src/app/check/
git commit -m "feat: add QR scanner and check-in page with success/duplicate/error states"
```

---

## Task 12: Student Page

**Files:**
- Create: `src/app/student/page.tsx`, `src/components/MonthlyCalendar.tsx`, `src/components/PhotoUpload.tsx`
- Create: `src/app/api/checkins/route.ts`, `src/app/api/users/me/route.ts`, `src/app/api/users/me/photo/route.ts`

- [ ] **Step 1: Create check-in history API**

Create `src/app/api/checkins/route.ts`:
```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId: session.user.dbUserId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({ checkIns });
}
```

- [ ] **Step 2: Create user profile API**

Create `src/app/api/users/me/route.ts`:
```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    include: { mealPeriod: true },
  });

  return NextResponse.json({ user });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const user = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Students can only update photo (handled via photo API)
  // Teachers can update everything except email
  if (user.role === "TEACHER") {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: body.name ?? user.name,
        subject: body.subject ?? user.subject,
        homeroom: body.homeroom ?? user.homeroom,
        position: body.position ?? user.position,
      },
    });
    return NextResponse.json({ user: updated });
  }

  return NextResponse.json({ error: "수정 권한이 없습니다." }, { status: 403 });
}
```

- [ ] **Step 3: Create photo upload API**

Create `src/app/api/users/me/photo/route.ts`:
```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./public/uploads";
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || "5") ) * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `파일 크기는 ${process.env.MAX_FILE_SIZE_MB || 5}MB 이하여야 합니다.` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const resized = await sharp(buffer)
    .resize(300, 300, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${session.user.dbUserId}.webp`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await writeFile(filepath, resized);

  const photoUrl = `/uploads/${filename}?t=${Date.now()}`;
  await prisma.user.update({
    where: { id: session.user.dbUserId },
    data: { photoUrl },
  });

  return NextResponse.json({ photoUrl });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
  });

  if (user?.photoUrl) {
    const filename = `${session.user.dbUserId}.webp`;
    const filepath = path.join(UPLOAD_DIR, filename);
    try {
      await unlink(filepath);
    } catch {}
  }

  await prisma.user.update({
    where: { id: session.user.dbUserId },
    data: { photoUrl: null },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Create MonthlyCalendar component**

Create `src/components/MonthlyCalendar.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CheckInRecord {
  id: number;
  date: string;
  checkedAt: string;
  type: string;
}

export function MonthlyCalendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([]);

  useEffect(() => {
    fetch(`/api/checkins?year=${year}&month=${month}`)
      .then((res) => res.json())
      .then((data) => setCheckIns(data.checkIns || []));
  }, [year, month]);

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

  const getCheckIn = (day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return checkIns.find((c) => c.date.startsWith(dateStr));
  };

  const formatTime = (checkedAt: string) => {
    const d = new Date(checkedAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold">
          {year}년 {month}월
        </h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {dayNames.map((d) => (
          <div key={d} className="font-semibold py-1 text-muted-foreground">
            {d}
          </div>
        ))}

        {Array.from({ length: firstDayOfWeek }, (_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const checkIn = getCheckIn(day);
          return (
            <div
              key={day}
              className={`py-2 rounded-md text-sm ${
                checkIn
                  ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                  : ""
              }`}
            >
              <div>{day}</div>
              {checkIn && (
                <div className="text-[10px] text-green-600 dark:text-green-400">
                  {formatTime(checkIn.checkedAt)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create PhotoUpload component**

Create `src/components/PhotoUpload.tsx`:
```tsx
"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Trash2 } from "lucide-react";

interface PhotoUploadProps {
  currentPhotoUrl?: string | null;
  onPhotoChange: (url: string | null) => void;
}

export function PhotoUpload({ currentPhotoUrl, onPhotoChange }: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("photo", file);

    const res = await fetch("/api/users/me/photo", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    setUploading(false);

    if (res.ok) {
      onPhotoChange(data.photoUrl);
    }
  }

  async function handleDelete() {
    setUploading(true);
    await fetch("/api/users/me/photo", { method: "DELETE" });
    setUploading(false);
    onPhotoChange(null);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {currentPhotoUrl ? (
        <img
          src={currentPhotoUrl}
          alt="Profile"
          className="w-24 h-24 rounded-full object-cover border"
        />
      ) : (
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
          <Camera className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "업로드 중..." : "사진 변경"}
        </Button>
        {currentPhotoUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={uploading}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}
```

- [ ] **Step 6: Create Student page**

Create `src/app/student/page.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { PhotoUpload } from "@/components/PhotoUpload";
import { LogOut } from "lucide-react";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  grade: number;
  classNum: number;
  number: number;
  photoUrl: string | null;
  mealPeriod?: {
    startDate: string;
    endDate: string;
  };
}

export default function StudentPage() {
  const { data: session } = useSession();
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    fetch("/api/users/me")
      .then((res) => res.json())
      .then((data) => setUser(data.user));
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        로딩 중...
      </div>
    );
  }

  const hasMealPeriod = !!user.mealPeriod;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="font-bold text-lg">포산밀</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4">
        <Tabs defaultValue="qr">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="qr">QR</TabsTrigger>
            <TabsTrigger value="profile">개인정보</TabsTrigger>
            <TabsTrigger value="history">확인</TabsTrigger>
          </TabsList>

          <TabsContent value="qr">
            <Card>
              <CardContent className="pt-6 text-center">
                {hasMealPeriod ? (
                  <>
                    <QRGenerator type="STUDENT" />
                    <p className="mt-4 font-semibold">
                      {user.grade}학년 {user.classNum}반 {user.number}번{" "}
                      {user.name}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      석식 신청 기간:{" "}
                      {new Date(user.mealPeriod!.startDate).toLocaleDateString("ko-KR")}
                      {" ~ "}
                      {new Date(user.mealPeriod!.endDate).toLocaleDateString("ko-KR")}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground py-8">
                    현재 석식 신청 기간이 아닙니다.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <PhotoUpload
                  currentPhotoUrl={user.photoUrl}
                  onPhotoChange={(url) =>
                    setUser({ ...user, photoUrl: url })
                  }
                />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">학년</span>
                    <span>{user.grade}학년</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">반</span>
                    <span>{user.classNum}반</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">번호</span>
                    <span>{user.number}번</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">이름</span>
                    <span>{user.name}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardContent className="pt-6">
                <MonthlyCalendar />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/app/student/ src/app/api/checkins/ src/app/api/users/ src/components/MonthlyCalendar.tsx src/components/PhotoUpload.tsx
git commit -m "feat: add student page with QR, profile, and monthly check-in history"
```

---

## Task 13: Teacher Page

**Files:**
- Create: `src/app/teacher/page.tsx`, `src/app/api/teacher/students/route.ts`, `src/components/StudentTable.tsx`

- [ ] **Step 1: Create teacher students API**

Create `src/app/api/teacher/students/route.ts`:
```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
  });

  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  // Parse homeroom "2-6" -> grade=2, classNum=6
  const [gradeStr, classStr] = teacher.homeroom.split("-");
  const grade = parseInt(gradeStr);
  const classNum = parseInt(classStr);

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const students = await prisma.user.findMany({
    where: {
      role: "STUDENT",
      grade,
      classNum,
    },
    include: {
      mealPeriod: true,
      checkIns: {
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { date: "asc" },
      },
    },
    orderBy: { number: "asc" },
  });

  return NextResponse.json({ students, grade, classNum });
}
```

- [ ] **Step 2: Create StudentTable component**

Create `src/components/StudentTable.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Student {
  id: number;
  name: string;
  number: number;
  photoUrl: string | null;
  mealPeriod?: { startDate: string; endDate: string } | null;
  checkIns: { date: string; checkedAt: string }[];
}

export function StudentTable() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [students, setStudents] = useState<Student[]>([]);
  const [grade, setGrade] = useState(0);
  const [classNum, setClassNum] = useState(0);

  useEffect(() => {
    fetch(`/api/teacher/students?year=${year}&month=${month}`)
      .then((res) => res.json())
      .then((data) => {
        setStudents(data.students || []);
        setGrade(data.grade || 0);
        setClassNum(data.classNum || 0);
      });
  }, [year, month]);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const daysInMonth = new Date(year, month, 0).getDate();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold">
          {grade}학년 {classNum}반 — {year}년 {month}월
        </h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {students.map((student) => {
          const checkedDays = student.checkIns.map((c) =>
            new Date(c.date).getDate()
          );
          const hasMealPeriod = !!student.mealPeriod;

          return (
            <div
              key={student.id}
              className="border rounded-lg p-3"
            >
              <div className="flex items-center gap-3 mb-2">
                {student.photoUrl ? (
                  <img
                    src={student.photoUrl}
                    alt={student.name}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                    {student.name.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="font-semibold">
                    {student.number}번 {student.name}
                  </p>
                  <div className="flex gap-1">
                    {hasMealPeriod ? (
                      <Badge variant="secondary" className="text-xs">석식 신청</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">미신청</Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {student.checkIns.length}/{daysInMonth}일
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-10 gap-1 text-xs text-center">
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const checked = checkedDays.includes(day);
                  return (
                    <div
                      key={day}
                      className={`py-1 rounded ${
                        checked
                          ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                          : "bg-muted"
                      }`}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create Teacher page**

Create `src/app/teacher/page.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { QRGenerator } from "@/components/QRGenerator";
import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { PhotoUpload } from "@/components/PhotoUpload";
import { StudentTable } from "@/components/StudentTable";
import { LogOut } from "lucide-react";

interface TeacherProfile {
  id: number;
  name: string;
  email: string;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
  photoUrl: string | null;
}

export default function TeacherPage() {
  const [user, setUser] = useState<TeacherProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", subject: "", homeroom: "", position: "" });

  useEffect(() => {
    fetch("/api/users/me")
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        if (data.user) {
          setForm({
            name: data.user.name || "",
            subject: data.user.subject || "",
            homeroom: data.user.homeroom || "",
            position: data.user.position || "",
          });
        }
      });
  }, []);

  async function handleSave() {
    const res = await fetch("/api/users/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (res.ok) {
      setUser(data.user);
      setEditing(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        로딩 중...
      </div>
    );
  }

  const isHomeroom = !!user.homeroom;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="font-bold text-lg">포산밀</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4">
        <Tabs defaultValue="personal">
          <TabsList className={`grid w-full ${isHomeroom ? "grid-cols-4" : "grid-cols-3"}`}>
            <TabsTrigger value="personal">개인석식</TabsTrigger>
            <TabsTrigger value="work">근무</TabsTrigger>
            {isHomeroom && (
              <TabsTrigger value="students">학생관리</TabsTrigger>
            )}
            <TabsTrigger value="profile">개인정보</TabsTrigger>
          </TabsList>

          <TabsContent value="personal">
            <Card>
              <CardContent className="pt-6 text-center">
                <QRGenerator type="PERSONAL" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-1">
                  개인 석식용 QR
                </p>
              </CardContent>
            </Card>
            <Card className="mt-4">
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-4">석식 이력</h3>
                <MonthlyCalendar />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="work">
            <Card>
              <CardContent className="pt-6 text-center">
                <QRGenerator type="WORK" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">
                  근무 석식용 QR
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {isHomeroom && (
            <TabsContent value="students">
              <Card>
                <CardContent className="pt-6">
                  <StudentTable />
                </CardContent>
              </Card>
            </TabsContent>
          )}

          <TabsContent value="profile">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <PhotoUpload
                  currentPhotoUrl={user.photoUrl}
                  onPhotoChange={(url) => setUser({ ...user, photoUrl: url })}
                />
                {editing ? (
                  <div className="space-y-3">
                    <div>
                      <Label>이름</Label>
                      <Input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>교과명</Label>
                      <Input
                        value={form.subject}
                        onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>담임 (예: 2-6)</Label>
                      <Input
                        value={form.homeroom}
                        onChange={(e) => setForm({ ...form, homeroom: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>직책</Label>
                      <Input
                        value={form.position}
                        onChange={(e) => setForm({ ...form, position: e.target.value })}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleSave} className="flex-1">저장</Button>
                      <Button variant="outline" onClick={() => setEditing(false)} className="flex-1">
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">이메일</span>
                      <span>{user.email}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">이름</span>
                      <span>{user.name}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">교과명</span>
                      <span>{user.subject || "-"}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">담임</span>
                      <span>{user.homeroom || "해당없음"}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">직책</span>
                      <span>{user.position || "-"}</span>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full mt-4"
                      onClick={() => setEditing(true)}
                    >
                      정보 수정
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/teacher/ src/app/api/teacher/ src/components/StudentTable.tsx
git commit -m "feat: add teacher page with personal/work QR, student management, and profile"
```

---

## Task 14: Admin Page — Spreadsheet Import and User CRUD

**Files:**
- Create: `src/app/admin/page.tsx`, `src/app/api/admin/import/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/meal-periods/route.ts`

- [ ] **Step 1: Create Spreadsheet import API**

Create `src/app/api/admin/import/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function extractGid(url: string): string {
  const match = url.match(/gid=(\d+)/);
  return match ? match[1] : "0";
}

function csvToRows(csv: string): string[][] {
  return csv
    .split("\n")
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")))
    .filter((row) => row.some((cell) => cell.length > 0));
}

export async function POST(request: Request) {
  const { studentSheetUrl, teacherSheetUrl } = await request.json();

  let studentCount = 0;
  let teacherCount = 0;

  // Import students
  if (studentSheetUrl) {
    const id = extractSpreadsheetId(studentSheetUrl);
    const gid = extractGid(studentSheetUrl);
    if (!id) {
      return NextResponse.json({ error: "Invalid student sheet URL" }, { status: 400 });
    }

    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const res = await fetch(csvUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: "학생 스프레드시트를 가져올 수 없습니다. 공개 설정을 확인하세요." },
        { status: 400 }
      );
    }

    const csv = await res.text();
    const rows = csvToRows(csv);
    // Skip header row; columns: email, grade, classNum, number, name, startDate, endDate
    for (let i = 1; i < rows.length; i++) {
      const [email, grade, classNum, number, name, startDate, endDate] = rows[i];
      if (!email || !name) continue;

      const user = await prisma.user.upsert({
        where: { email },
        update: {
          name,
          grade: parseInt(grade),
          classNum: parseInt(classNum),
          number: parseInt(number),
        },
        create: {
          email,
          name,
          role: "STUDENT",
          grade: parseInt(grade),
          classNum: parseInt(classNum),
          number: parseInt(number),
        },
      });

      if (startDate && endDate) {
        await prisma.mealPeriod.upsert({
          where: { userId: user.id },
          update: {
            startDate: new Date(startDate),
            endDate: new Date(endDate),
          },
          create: {
            userId: user.id,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
          },
        });
      }

      studentCount++;
    }
  }

  // Import teachers
  if (teacherSheetUrl) {
    const id = extractSpreadsheetId(teacherSheetUrl);
    const gid = extractGid(teacherSheetUrl);
    if (!id) {
      return NextResponse.json({ error: "Invalid teacher sheet URL" }, { status: 400 });
    }

    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const res = await fetch(csvUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: "교사 스프레드시트를 가져올 수 없습니다. 공개 설정을 확인하세요." },
        { status: 400 }
      );
    }

    const csv = await res.text();
    const rows = csvToRows(csv);
    // Skip header; columns: email, subject, homeroom, position, name
    for (let i = 1; i < rows.length; i++) {
      const [email, subject, homeroom, position, name] = rows[i];
      if (!email || !name) continue;

      await prisma.user.upsert({
        where: { email },
        update: { name, subject, homeroom: homeroom || null, position },
        create: {
          email,
          name,
          role: "TEACHER",
          subject,
          homeroom: homeroom || null,
          position,
        },
      });

      teacherCount++;
    }
  }

  return NextResponse.json({
    message: `학생 ${studentCount}명, 교사 ${teacherCount}명 등록 완료`,
    studentCount,
    teacherCount,
  });
}
```

- [ ] **Step 2: Create admin users API**

Create `src/app/api/admin/users/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role") as "STUDENT" | "TEACHER" | null;

  const where = role ? { role } : {};
  const users = await prisma.user.findMany({
    where,
    include: { mealPeriod: true },
    orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const body = await request.json();

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      role: body.role,
      grade: body.grade || null,
      classNum: body.classNum || null,
      number: body.number || null,
      subject: body.subject || null,
      homeroom: body.homeroom || null,
      position: body.position || null,
    },
  });

  if (body.role === "STUDENT" && body.startDate && body.endDate) {
    await prisma.mealPeriod.create({
      data: {
        userId: user.id,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
      },
    });
  }

  return NextResponse.json({ user }, { status: 201 });
}

export async function PUT(request: Request) {
  const body = await request.json();

  const user = await prisma.user.update({
    where: { id: body.id },
    data: {
      name: body.name,
      grade: body.grade,
      classNum: body.classNum,
      number: body.number,
      subject: body.subject,
      homeroom: body.homeroom,
      position: body.position,
    },
  });

  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "0");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Create meal periods API**

Create `src/app/api/admin/meal-periods/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request) {
  const body = await request.json();

  const mealPeriod = await prisma.mealPeriod.upsert({
    where: { userId: body.userId },
    update: {
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    },
    create: {
      userId: body.userId,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    },
  });

  return NextResponse.json({ mealPeriod });
}
```

- [ ] **Step 4: Create admin dashboard page**

Create `src/app/admin/page.tsx`:
```tsx
"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { LogOut, Plus, Download, Trash2 } from "lucide-react";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  grade?: number;
  classNum?: number;
  number?: number;
  subject?: string;
  homeroom?: string;
  position?: string;
  mealPeriod?: { startDate: string; endDate: string } | null;
}

interface DashboardData {
  date: string;
  studentCount: number;
  teacherWorkCount: number;
  teacherPersonalCount: number;
  records: {
    userName: string;
    role: string;
    type: string;
    checkedAt: string;
    grade?: number;
    classNum?: number;
    number?: number;
  }[];
}

export default function AdminPage() {
  const [studentSheetUrl, setStudentSheetUrl] = useState("");
  const [teacherSheetUrl, setTeacherSheetUrl] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [userFilter, setUserFilter] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    role: "STUDENT" as "STUDENT" | "TEACHER",
    email: "", name: "", grade: "", classNum: "", number: "",
    subject: "", homeroom: "", position: "",
    startDate: "", endDate: "",
  });

  useEffect(() => {
    fetchUsers();
    fetchDashboard();
  }, [userFilter]);

  async function fetchUsers() {
    const res = await fetch(`/api/admin/users?role=${userFilter}`);
    const data = await res.json();
    setUsers(data.users || []);
  }

  async function fetchDashboard() {
    const res = await fetch("/api/admin/dashboard");
    const data = await res.json();
    setDashboard(data);
  }

  async function handleImport() {
    setImporting(true);
    setImportMessage("");
    const res = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentSheetUrl, teacherSheetUrl }),
    });
    const data = await res.json();
    setImportMessage(data.message || data.error);
    setImporting(false);
    fetchUsers();
  }

  async function handleAddUser() {
    const body: Record<string, unknown> = {
      role: addForm.role,
      email: addForm.email,
      name: addForm.name,
    };

    if (addForm.role === "STUDENT") {
      body.grade = parseInt(addForm.grade);
      body.classNum = parseInt(addForm.classNum);
      body.number = parseInt(addForm.number);
      body.startDate = addForm.startDate;
      body.endDate = addForm.endDate;
    } else {
      body.subject = addForm.subject;
      body.homeroom = addForm.homeroom;
      body.position = addForm.position;
    }

    await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setAddDialogOpen(false);
    setAddForm({
      role: "STUDENT", email: "", name: "", grade: "", classNum: "", number: "",
      subject: "", homeroom: "", position: "", startDate: "", endDate: "",
    });
    fetchUsers();
  }

  async function handleDeleteUser(id: number) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    fetchUsers();
  }

  async function handleExport() {
    const res = await fetch("/api/admin/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `석식현황_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="font-bold text-lg">포산밀 관리자</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Spreadsheet Import */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Google Spreadsheet 가져오기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>학생 시트 URL</Label>
              <Input
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={studentSheetUrl}
                onChange={(e) => setStudentSheetUrl(e.target.value)}
              />
            </div>
            <div>
              <Label>교사 시트 URL</Label>
              <Input
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={teacherSheetUrl}
                onChange={(e) => setTeacherSheetUrl(e.target.value)}
              />
            </div>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? "가져오는 중..." : "Data 호출"}
            </Button>
            {importMessage && (
              <p className="text-sm text-muted-foreground">{importMessage}</p>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="users">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="users">사용자 관리</TabsTrigger>
            <TabsTrigger value="dashboard">석식 현황</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-2">
                    <Button
                      variant={userFilter === "STUDENT" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setUserFilter("STUDENT")}
                    >
                      학생
                    </Button>
                    <Button
                      variant={userFilter === "TEACHER" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setUserFilter("TEACHER")}
                    >
                      교사
                    </Button>
                  </div>

                  <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-1" /> 추가
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>사용자 추가</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div>
                          <Label>역할</Label>
                          <Select
                            value={addForm.role}
                            onValueChange={(v) =>
                              setAddForm({ ...addForm, role: v as "STUDENT" | "TEACHER" })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="STUDENT">학생</SelectItem>
                              <SelectItem value="TEACHER">교사</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>이메일</Label>
                          <Input
                            value={addForm.email}
                            onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>이름</Label>
                          <Input
                            value={addForm.name}
                            onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                          />
                        </div>

                        {addForm.role === "STUDENT" && (
                          <>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <Label>학년</Label>
                                <Input
                                  type="number"
                                  value={addForm.grade}
                                  onChange={(e) => setAddForm({ ...addForm, grade: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>반</Label>
                                <Input
                                  type="number"
                                  value={addForm.classNum}
                                  onChange={(e) => setAddForm({ ...addForm, classNum: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>번호</Label>
                                <Input
                                  type="number"
                                  value={addForm.number}
                                  onChange={(e) => setAddForm({ ...addForm, number: e.target.value })}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label>석식 시작일</Label>
                                <Input
                                  type="date"
                                  value={addForm.startDate}
                                  onChange={(e) => setAddForm({ ...addForm, startDate: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label>석식 종료일</Label>
                                <Input
                                  type="date"
                                  value={addForm.endDate}
                                  onChange={(e) => setAddForm({ ...addForm, endDate: e.target.value })}
                                />
                              </div>
                            </div>
                          </>
                        )}

                        {addForm.role === "TEACHER" && (
                          <>
                            <div>
                              <Label>교과명</Label>
                              <Input
                                value={addForm.subject}
                                onChange={(e) => setAddForm({ ...addForm, subject: e.target.value })}
                              />
                            </div>
                            <div>
                              <Label>담임 (예: 2-6)</Label>
                              <Input
                                value={addForm.homeroom}
                                onChange={(e) => setAddForm({ ...addForm, homeroom: e.target.value })}
                              />
                            </div>
                            <div>
                              <Label>직책</Label>
                              <Input
                                value={addForm.position}
                                onChange={(e) => setAddForm({ ...addForm, position: e.target.value })}
                              />
                            </div>
                          </>
                        )}

                        <Button onClick={handleAddUser} className="w-full">
                          추가
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-left">
                          {userFilter === "STUDENT" ? "학년-반-번호" : "교과/담임"}
                        </th>
                        <th className="p-2 text-left">
                          {userFilter === "STUDENT" ? "신청기간" : "직책"}
                        </th>
                        <th className="p-2 text-center w-16">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t">
                          <td className="p-2">{u.name}</td>
                          <td className="p-2">
                            {u.role === "STUDENT"
                              ? `${u.grade}-${u.classNum}-${u.number}`
                              : `${u.subject || "-"} / ${u.homeroom || "비담임"}`}
                          </td>
                          <td className="p-2">
                            {u.role === "STUDENT"
                              ? u.mealPeriod
                                ? `${new Date(u.mealPeriod.startDate).toLocaleDateString("ko-KR")} ~ ${new Date(u.mealPeriod.endDate).toLocaleDateString("ko-KR")}`
                                : "미신청"
                              : u.position || "-"}
                          </td>
                          <td className="p-2 text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteUser(u.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard">
            <Card>
              <CardContent className="pt-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">오늘의 석식 현황</h3>
                  <Button variant="outline" size="sm" onClick={handleExport}>
                    <Download className="h-4 w-4 mr-1" /> Excel 다운로드
                  </Button>
                </div>

                {dashboard && (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="border rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold">{dashboard.studentCount}</p>
                        <p className="text-xs text-muted-foreground">학생</p>
                      </div>
                      <div className="border rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold">{dashboard.teacherWorkCount}</p>
                        <p className="text-xs text-muted-foreground">교사(근무)</p>
                      </div>
                      <div className="border rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold">{dashboard.teacherPersonalCount}</p>
                        <p className="text-xs text-muted-foreground">교사(개인)</p>
                      </div>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="p-2 text-left">이름</th>
                            <th className="p-2 text-left">구분</th>
                            <th className="p-2 text-left">체크인 시각</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.records.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-2">
                                {r.role === "STUDENT"
                                  ? `${r.grade}-${r.classNum} ${r.number}번 ${r.userName}`
                                  : `${r.userName} 선생님`}
                              </td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-xs">
                                  {r.type === "STUDENT" ? "학생" : r.type === "WORK" ? "근무" : "개인"}
                                </Badge>
                              </td>
                              <td className="p-2">
                                {new Date(r.checkedAt).toLocaleTimeString("ko-KR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx src/app/api/admin/
git commit -m "feat: add admin page with spreadsheet import, user CRUD, and dashboard"
```

---

## Task 15: Admin Dashboard API and Excel Export

**Files:**
- Create: `src/app/api/admin/dashboard/route.ts`, `src/app/api/admin/export/route.ts`

- [ ] **Step 1: Create dashboard API**

Create `src/app/api/admin/dashboard/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date") || todayKST();
  const targetDate = new Date(dateParam);

  const checkIns = await prisma.checkIn.findMany({
    where: { date: targetDate },
    include: {
      user: {
        select: {
          name: true,
          role: true,
          grade: true,
          classNum: true,
          number: true,
        },
      },
    },
    orderBy: { checkedAt: "asc" },
  });

  const studentCount = checkIns.filter((c) => c.type === "STUDENT").length;
  const teacherWorkCount = checkIns.filter((c) => c.type === "WORK").length;
  const teacherPersonalCount = checkIns.filter((c) => c.type === "PERSONAL").length;

  const records = checkIns.map((c) => ({
    userName: c.user.name,
    role: c.user.role,
    type: c.type,
    checkedAt: c.checkedAt.toISOString(),
    grade: c.user.grade,
    classNum: c.user.classNum,
    number: c.user.number,
  }));

  return NextResponse.json({
    date: dateParam,
    studentCount,
    teacherWorkCount,
    teacherPersonalCount,
    records,
  });
}
```

- [ ] **Step 2: Create Excel export API**

Create `src/app/api/admin/export/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const checkIns = await prisma.checkIn.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
    },
    include: {
      user: {
        select: {
          name: true,
          role: true,
          grade: true,
          classNum: true,
          number: true,
          subject: true,
        },
      },
    },
    orderBy: [{ date: "asc" }, { checkedAt: "asc" }],
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${year}년 ${month}월 석식 현황`);

  sheet.columns = [
    { header: "날짜", key: "date", width: 12 },
    { header: "이름", key: "name", width: 15 },
    { header: "구분", key: "role", width: 10 },
    { header: "학년-반-번호", key: "classInfo", width: 15 },
    { header: "유형", key: "type", width: 10 },
    { header: "체크인 시각", key: "checkedAt", width: 15 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const c of checkIns) {
    const typeLabel = c.type === "STUDENT" ? "학생" : c.type === "WORK" ? "근무" : "개인";
    const roleLabel = c.user.role === "STUDENT" ? "학생" : "교사";
    const classInfo = c.user.role === "STUDENT"
      ? `${c.user.grade}-${c.user.classNum}-${c.user.number}`
      : c.user.subject || "-";

    sheet.addRow({
      date: c.date.toISOString().slice(0, 10),
      name: c.user.name,
      role: roleLabel,
      classInfo,
      type: typeLabel,
      checkedAt: c.checkedAt.toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="meal_${year}_${month}.xlsx"`,
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/dashboard/ src/app/api/admin/export/
git commit -m "feat: add admin dashboard API and Excel export"
```

---

## Task 16: Final Integration and Verification

- [ ] **Step 1: Start local PostgreSQL and run migrations**

Run:
```bash
docker compose up -d
npx prisma migrate dev
npx prisma db seed
```

- [ ] **Step 2: Start dev server and verify pages load**

Run:
```bash
npm run dev
```

Verify in browser:
- `http://localhost:3000` — Landing page with Google login button and admin link
- `http://localhost:3000/check` — QR scanner page (camera access prompt)
- `http://localhost:3000/admin/login` — Admin login form
- Login as admin with `admin` / `admin1234` → redirects to `/admin`
- Dark/light toggle works on all pages

- [ ] **Step 3: Test admin import flow**

1. Create a public Google Spreadsheet with student data (columns: email, grade, classNum, number, name, startDate, endDate)
2. Paste URL into admin import → click "Data 호출"
3. Verify users appear in the users table

- [ ] **Step 4: Test QR check-in flow**

1. Log in as a registered student/teacher
2. Verify QR code displays with countdown
3. Open `/check` on another device/tab
4. Scan QR → verify green success message
5. Scan same QR again → verify red duplicate warning

- [ ] **Step 5: Test Excel export**

1. In admin dashboard, click "Excel 다운로드"
2. Verify .xlsx file downloads with check-in data

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final integration and cleanup"
```
