# PROJECT_MAP — posanmeal (포산밀 석식 관리)

> **Purpose of this file:** Fast index of the entire codebase. Future Claude sessions read this FIRST and only open the specific files relevant to the current task. When the map is stale, run the `project-map-keeper` agent to refresh it.
>
> **Last update:** 2026-04-29 (split into prod/test deployments — main=prod meal.posan.kr, feat/posanmeal-mvp=test posanmeal.up.railway.app, shared DB+Volume)

---

## 0. Branch / Deployment Workflow

| Branch | Role | Domain | Railway service |
|--------|------|--------|-----------------|
| `main` | **production** | `https://meal.posan.kr` | prod service (watch=main) |
| `feat/posanmeal-mvp` | **staging/test** | `https://posanmeal.up.railway.app` | test service (watch=feat/posanmeal-mvp) |

**Shared resources** (single school, two domains pointing at the same data):
- PostgreSQL DB — single instance, both services use same `DATABASE_URL`.
- Volume `/app/uploads` — content kept identical via copy/sync; user-uploaded photos must appear on both.
- All secrets (`AUTH_SECRET`, `QR_JWT_SECRET`, `AUTH_GOOGLE_*`, `ADMIN_*`) — identical across services so JWTs and OAuth work cross-domain.
- Per-environment-only: `NEXT_PUBLIC_SITE_URL`, `AUTH_URL`.

**Workflow:**
1. Always commit & push to `feat/posanmeal-mvp` first → Railway test deploy → verify on `posanmeal.up.railway.app`.
2. Fast-forward / merge into `main` → push → Railway prod deploy → `meal.posan.kr` updates.
3. Keep the two branches diverged for minutes, not days.

**Migration safety (because DB is shared):** strictly additive Prisma migrations. No column drop / rename / NOT-NULL-without-default in a single deploy. Test deploy applies the migration first, prod runs old code briefly against the new schema — that gap must remain non-breaking. Use `prisma-migration-guardian` agent before any risky migration.

## 1. Overview

Korean high-school dinner (석식) management app — branding name **PosanMeal**. Students scan a daily QR code at a food-court tablet to check in; teachers have work + personal QR variants; admins import users from Google Sheets and export monthly Excel reports.

**Auth roles:** `STUDENT`, `TEACHER`, `ADMIN` (admin uses credentials provider; others use Google OAuth). Teachers may additionally carry `adminLevel ∈ {NONE, SUBADMIN, ADMIN}` — SUBADMIN gets read-only access to `/admin`, ADMIN gets full `/admin` write access (equivalent to env-credentials admin). See spec `docs/superpowers/specs/2026-04-14-teacher-admin-roles-design.md`.

## 2. Tech Stack

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.2.1 | **Breaking changes vs older versions** — see `AGENTS.md` |
| Runtime | React | 19.2.4 | |
| Language | TypeScript | ^5 strict | `@/*` → `./src/*` |
| DB | PostgreSQL + Prisma | ^7.6.0 | `@prisma/adapter-pg`, generated client at `src/generated/prisma` |
| Auth | NextAuth | ^5.0.0-beta.30 | Google OAuth + Credentials (admin) |
| Styling | Tailwind CSS | ^4 | `@tailwindcss/postcss` |
| UI kit | shadcn/ui | ^4.1.1 | `src/components/ui/` |
| Icons | lucide-react | ^1.7.0 | |
| Theme | next-themes | ^0.4.6 | dark/light |
| QR | qrcode / qr-scanner / jsqr / html5-qrcode | | JWT-signed tokens, 180s expiry |
| JWT | jsonwebtoken | ^9.0.3 | QR_JWT_SECRET |
| Hash | bcryptjs | ^3.0.3 | Admin password |
| Images | sharp | ^0.34.5 | Resize → 300x300 WebP (serverExternalPackages) |
| Excel | exceljs | ^4.4.0 | Admin export |
| Toast | sonner | ^2.0.7 | |

Scripts: `dev`, `build`, `start`, `lint`, `generate:icons` (regenerates PWA icon PNGs via `scripts/generate-pwa-icons.mjs`). Seed: `npx tsx prisma/seed.ts`.

## 3. Directory Layout

```
posanmeal/
├── prisma/
│   ├── schema.prisma        # Data models (see §6)
│   ├── seed.ts              # Seeds admin user
│   └── migrations/          # v1 init + v2 indexes
├── public/
│   ├── icons/               # PWA icons: icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
│   ├── meal.png             # 256x256 transparent PNG — BrandMark logo source
│   ├── meal.ico             # Favicon (ICO)
│   ├── icon-maskable-512.png # PWA maskable icon (also in icons/)
│   └── uploads/             # Photo storage (Railway volume mount)
├── src/
│   ├── app/                 # App Router — pages + API (see §4, §5)
│   ├── components/          # Feature + UI components (see §7)
│   ├── lib/                 # prisma, qr-token, timezone, utils, settings-cache, fetcher (see §8)
│   ├── hooks/               # SWR data hooks (see §8b)
│   ├── providers/           # Session + Theme providers
│   ├── types/               # TS type defs
│   ├── generated/prisma/    # Prisma client output (do not edit)
│   ├── auth.ts              # NextAuth config (see §9)
│   └── middleware.ts        # Route protection (see §9)
├── docs/superpowers/
│   ├── specs/2026-03-28-posanmeal-design.md      # Full design doc (378 lines)
│   └── plans/2026-03-28-posanmeal-implementation.md  # Impl plan
├── scripts/
│   └── generate-pwa-icons.mjs  # Generates public/icons/* from source image
├── .env.example             # Env var template (see §10)
├── next.config.ts           # serverExternalPackages: ["sharp"]
├── prisma.config.ts         # Prisma CLI config
├── components.json          # shadcn/ui config
└── docker-compose.yml       # Local Postgres
```

## 4. Pages (`src/app`)

| Route | File | Type | Auth | Purpose |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | Page | public | Landing + Google login; redirects logged-in users by role |
| `/layout.tsx` | `src/app/layout.tsx` | Root layout | — | Wraps in AuthProvider + ThemeProvider; Geist font; metadata applicationName/title "PosanMeal", OG/Twitter cards, appleWebApp.title; viewport themeColor light/dark |
| `/manifest.webmanifest` | `src/app/manifest.ts` | Next.js manifest | — | PWA manifest: name "PosanMeal — 포산고 석식 관리", short_name "PosanMeal", standalone display, lang "ko", orientation "any", theme_color #f59e0b, background_color #fef8f1; icons: /icon-192.png (any), /icon-512.png (any), /icon-maskable-512.png (maskable) — served from public root, not public/icons/ |
| `/check` | `src/app/check/page.tsx` | Page | public | Food-court tablet QR scanner; supports both online (JWT) and local (`posanmeal:…`) QR formats; uses `local-db` IndexedDB for offline check-in storage and sync |
| `/admin/login` | `src/app/admin/login/page.tsx` | Page | public | Admin username/password form |
| `/student` | `src/app/student/page.tsx` | Page | STUDENT | 5탭 (식단 tab with MealMenu, 신청 tab with applications + signature, QR generator, profile, history); 신청 tab only shown when applications exist |
| `/teacher` | `src/app/teacher/page.tsx` | Page | TEACHER | Personal+Work QR, profile edit, history, (homeroom → 학생관리 tab) |
| `/admin` | `src/app/admin/page.tsx` | Page | ADMIN | 5탭: 사용자관리(Spreadsheet import + user CRUD), 신청관리(MealApplication CRUD + registrations + Excel bulk import/export via `/api/admin/applications/[id]/import` and `/export`), 석식확인(monthly grid), 당일현황(daily stats), 설정(operationMode toggle + QR refresh + local-db admin sync) |

## 5. API Endpoints (`src/app/api`)

### Auth
- `GET|POST /api/auth/[...nextauth]` — NextAuth handlers

### Check-in (public)
- `POST /api/checkin` — validates JWT, date, meal period, duplicate; body `{ token }` → `{ success, user, type, checkedAt, error?, duplicate? }`
- `GET  /api/qr/token?type=STUDENT|WORK|PERSONAL` (STUDENT/TEACHER) → `{ token, expiresIn, mode: "online"|"local" }`. Online mode: JWT, expiresIn=180. Local mode: plain string `posanmeal:{userId}:{generation}:{type}`, expiresIn=0.

### User-self (STUDENT/TEACHER)
- `GET  /api/users/me` → full profile
- `PUT  /api/users/me` (TEACHER) → update name/subject/homeroom/position
- `POST /api/users/me/photo` — multipart `photo` → resized WebP → `{ photoUrl }`
- `DELETE /api/users/me/photo`
- `GET  /api/checkins?year=&month=` → `{ checkIns: [...] }`
- `GET  /api/uploads/[filename]` (public) — serves stored images, 3600s cache

### Student — applications (STUDENT/TEACHER)
- `GET  /api/applications` — open applications with current user's registration status
- `GET  /api/applications/my` — all registrations for the current user
- `POST /api/applications/[id]/register` — body `{ signature }` → create MealRegistration (STUDENT only)
- `DELETE /api/applications/[id]/register` — cancel own registration (within apply window)

### Teacher
- `GET /api/teacher/students?year=&month=` (homeroom only) → class roster w/ check-ins

### Admin (all ADMIN-gated)
- `GET    /api/admin/users?role=STUDENT|TEACHER`
- `POST   /api/admin/users` — create user
- `PUT    /api/admin/users` — update (keyed by id)
- `DELETE /api/admin/users?id=`
- `GET    /api/admin/applications` — all applications with approved/cancelled counts
- `POST   /api/admin/applications` — create MealApplication `{ title, type, applyStart, applyEnd, mealStart?, mealEnd?, description? }`
- `PUT    /api/admin/applications/[id]` — update MealApplication
- `DELETE /api/admin/applications/[id]` — delete MealApplication
- `POST   /api/admin/applications/[id]/close` — set status CLOSED
- `GET    /api/admin/applications/[id]/registrations` — list registrations (with user info)
- `POST   /api/admin/applications/[id]/registrations` — admin-add a user `{ userId }` (signature="", addedBy="ADMIN")
- `PATCH  /api/admin/applications/[id]/registrations/[regId]` — body `{ status }` toggle APPROVED↔CANCELLED
- `GET    /api/admin/applications/[id]/export` — XLSX export of approved registrations; `?template=true` → blank template with all students pre-filled (O if already registered)
- `POST   /api/admin/applications/[id]/import` — multipart `file` (filled-in template XLSX); bulk-creates MealRegistration rows from rows with E-column "O"; returns `{ added, skippedExisting, skippedNotFound, total }`
- `GET    /api/admin/dashboard?date=YYYY-MM-DD` — daily stats + records
- `PATCH  /api/admin/checkins` — body `{ id, type }` toggle WORK↔PERSONAL for a teacher check-in record
- `POST   /api/admin/checkins/toggle` — admin manual edit; body `{ userId, date: "YYYY-MM-DD", action: "cycle" | "toggle" }`. cycle (teacher): none→WORK→PERSONAL→delete. toggle (student): none↔STUDENT. Requires `canWriteAdmin` (no subadmin)
- `POST   /api/admin/import` — body `{ studentSheetUrl?, teacherSheetUrl? }` (Google Sheets CSV)
- `GET    /api/admin/export?year=&month=` — returns monthly check-in .xlsx

### System settings (mixed auth)
- `GET  /api/system/settings` — public; returns `{ operationMode, qrGeneration }`
- `PUT  /api/system/settings` — ADMIN only; body `{ operationMode?, refreshQR? }` → upserts SystemSetting rows

### Sync (ADMIN-only)
- `GET  /api/sync/download` — returns users, `eligibleUserIds` (from active MealRegistrations), settings, serverTime for local-mode bootstrap
- `POST /api/sync/upload` — body `{ checkins: [...] }` → writes local check-ins to DB; returns `{ accepted, duplicates, rejected }`

## 6. Database Schema (`prisma/schema.prisma`)

**Enums**
- `Role`: STUDENT | TEACHER
- `CheckInType`: STUDENT | WORK | PERSONAL
- `AdminLevel`: NONE | SUBADMIN | ADMIN

**Models**
- **Admin** — `id`, `username` UNIQUE, `passwordHash`, `createdAt` (legacy; current admin uses env vars via credentials provider)
- **User** — `id`, `email` UNIQUE, `name`, `role`, `grade?`, `classNum?`, `number?` (student only), `subject?`, `homeroom?` (e.g. "2-6"), `position?` (teacher), `photoUrl?`, `adminLevel` (AdminLevel, default NONE), `createdAt`, `updatedAt`. Relations: `registrations` (1:N), `checkIns` (1:N). Indexes `(role, grade, classNum, number)` and `(role, adminLevel)`.
- **MealApplication** — `id`, `title`, `description?`, `type` ("DINNER"|"BREAKFAST"|"OTHER"), `applyStart @db.Date`, `applyEnd @db.Date`, `mealStart? @db.Date`, `mealEnd? @db.Date`, `status` ("OPEN"|"CLOSED", default OPEN), `createdAt`, `updatedAt`. Indexes on `status` and `(applyStart, applyEnd)`.
- **MealRegistration** — `id`, `applicationId`, `userId`, `signature @db.Text`, `status` ("APPROVED"|"CANCELLED", default APPROVED), `createdAt`, `cancelledAt?`, `cancelledBy?` ("STUDENT"|"ADMIN"), `addedBy?` (null=학생 본인, "ADMIN"=관리자 추가). Unique `(applicationId, userId)`. Indexes on `userId` and `(applicationId, status)`. FK cascade on both FKs.
- **CheckIn** — `id`, `userId`, `date @db.Date`, `checkedAt`, `type`. Unique `(userId, date)`. Indexes on `date` and `userId`. FK cascade.
- **SystemSetting** — `key` (PK String), `value` String, `updatedAt`. Key-value store for server-side settings (e.g. `operationMode`: "online"|"local", `qrGeneration`: integer counter).

## 7. Components

### Feature (`src/components/`)
| Component | Props | Purpose |
|---|---|---|
| `BrandMark.tsx` | `variant?: "header"\|"floating"\|"overlay"`, `label?`, `href?`, `className?` | Reusable top-left logo chip; renders `/meal.png`; links to `/`; used on all pages |
| `QRGenerator.tsx` | `type: "STUDENT"\|"WORK"\|"PERSONAL"` | Fetches token via `/api/qr/token`; online mode shows countdown + auto-refresh 30s before expiry; local mode shows static QR with "로컬 모드" label (no countdown) |
| `QRScanner.tsx` | `onScan: (data: string) => void` | qr-scanner camera w/ 2s cooldown |
| `MonthlyCalendar.tsx` | — | Self-fetches check-ins, month nav |
| `AdminMealTable.tsx` | `refreshKey?: number` | Monthly check-in grid for admin; 4 tabs (교사/1~3학년), month nav, Excel export, teacher cell click toggles WORK↔PERSONAL inline |
| `StudentTable.tsx` | — | Homeroom roster + check-in grid |
| `MealMenu.tsx` | — | Fetches daily meal info from NEIS API (`/api/meal`); shows 조식/중식/석식 with dish names, calories, allergy info; date navigation; KST-aware |
| `SignaturePad.tsx` | `onSignatureChange: (base64\|null) => void`, `height?` | Canvas-based signature input; used in student meal application modal |
| `PhotoUpload.tsx` | `currentPhotoUrl?`, `onPhotoChange` | Upload/delete w/ preview |
| `ThemeToggle.tsx` | — | next-themes toggle, hydration-safe |
| `PageSkeleton.tsx` | — | Loading skeleton components: `QRCardSkeleton`, `ProfileCardSkeleton`, `CalendarSkeleton`, `TableSkeleton`, `DashboardSkeleton`, `PageLoadingSkeleton`; used by pages while SWR data loads |

### UI primitives (`src/components/ui/`)
shadcn/ui: button, card, dialog, dropdown-menu, input, label, select, separator, table, tabs, badge, avatar, sonner.

## 8. Lib (`src/lib/`)

| File | Exports | Notes |
|---|---|---|
| `prisma.ts` | `prisma` singleton | PG pool: max 20 conns, 30s idle, 5s connect |
| `qr-token.ts` | `signQRToken`, `verifyQRToken`, `getQRExpirySeconds` | JWT, 180s default |
| `timezone.ts` | `TIMEZONE`, `nowKST`, `todayKST`, `formatKST`, `formatDateKST`, `formatTimeKST` | Asia/Seoul everywhere |
| `utils.ts` | `cn(...inputs)` | clsx + tailwind-merge |
| `local-db.ts` | `getSetting`, `setSetting`, `getUser`, `replaceAllUsers`, `isEligible`, `replaceAllEligibleUsers`, `getCheckIn`, `addCheckIn`, `getUnsyncedCheckIns`, `markCheckInsSynced`, `getUnsyncedCount`, `clearSyncedCheckIns`, `clearAllData` | Client-side IndexedDB wrapper for offline/local mode (DB v3; `synced` field is `number` 0/1; stores: settings, users, eligibleUsers, checkins — `mealPeriods` store replaced by `eligibleUsers` in v3) |
| `neis-meal.ts` | `Dish`, `Meal`, `MealResponse` (interfaces), `ALLERGY_MAP` | NEIS 급식 API client (`open.neis.go.kr`); office D10, school 7240189; 1-hour in-memory cache; exports types used by `MealMenu.tsx` |
| `settings-cache.ts` | `getCachedSettings`, `invalidateSettingsCache` | Server-side in-memory cache (30s TTL) for `SystemSetting` rows (`operationMode`, `qrGeneration`); used by `/api/system/settings` and `/api/qr/token` |
| `fetcher.ts` | `fetcher` | Generic SWR fetcher; throws with `.status` + `.info` on non-OK responses |
| `permissions.ts` | `EffectiveLevel`, `getEffectiveAdminLevel`, `canWriteAdmin`, `canReadAdmin` | Resolves effective admin level from session: env-admin role=ADMIN → ADMIN; teacher with `adminLevel` ADMIN/SUBADMIN → respective level; used by middleware and API routes |

## 8b. Hooks (`src/hooks/`)

SWR-based data hooks; all use `fetcher` from `src/lib/fetcher.ts`.

| Hook | API | Returns |
|---|---|---|
| `useUser` | `GET /api/users/me` | `{ user, error, isLoading, mutate }` |
| `useApplications` | `GET /api/applications` | `{ applications, error, isLoading, mutate }` |
| `useCheckins(year, month)` | `GET /api/checkins` | `{ checkIns, error, isLoading }` |
| `useTeacherStudents(year, month)` | `GET /api/teacher/students` | `{ students, grade, classNum, error, isLoading }` |
| `useAdminUsers` | `GET /api/admin/users` | `{ users, error, isLoading, mutate }` |
| `useAdminApps` | `GET /api/admin/applications` | `{ apps, error, isLoading, mutate }` |
| `useAdminDashboard(date?)` | `GET /api/admin/dashboard` | `{ dashboard, error, isLoading, mutate }` (30s auto-refresh) |
| `useSystemSettings` | `GET /api/system/settings` | `{ settings, error, isLoading, mutate }` |
| `useAdminPermission` | session only (no API) | `{ canWrite, canRead, isSubadmin, isTeacher, isEnvAdmin, displayName, badgeLabel, dbUserId }` — derives effective admin level from session for client-side gating |

## 9. Auth & Middleware

**`src/auth.ts`** — NextAuth v5
- `trustHost: true` — required for Railway reverse-proxy deployment
- **Google**: `signIn` callback looks up User by email; rejects if not in DB; selects `id`, `role`, `adminLevel`
- **Credentials (admin)**: validates against `ADMIN_USERNAME` / `ADMIN_PASSWORD` (plain env var, not hashed)
- **jwt callback**: first login → fetch `role`, `dbUserId`, `adminLevel` into token; admin provider sets role=ADMIN, adminLevel=ADMIN
- **session callback**: exposes `user.role`, `user.dbUserId`, `user.adminLevel`
- **session lifetime**: `maxAge` 365 days, `updateAge` 1 day (rolling); JWT `maxAge` 365 days
- signIn page `/`, error → `/`

**`src/middleware.ts`**
- Imports `canReadAdmin` from `src/lib/permissions`
- Public bypass: `/`, `/check`, `/admin/login`, `/api/auth/**`, `/api/checkin`, `/api/uploads/**`, `/api/system/settings/**`, `/api/sync/**`, `/api/meals/**`, `/_next/**`, `/uploads/**`
- Page role gates: `/student`→STUDENT, `/teacher`→TEACHER, `/admin/*`→`canReadAdmin()` (includes SUBADMIN teachers; else → `/admin/login`)
- API role gates: `/api/admin/**`→`canReadAdmin()` (403 if denied), `/api/teacher/**`→TEACHER (403)
- Matcher: `/((?!_next/|.*\\..*).*)` — skips `_next/` AND any path containing a `.` (covers all static assets: `.png`, `.ico`, `.webmanifest`, `.svg`, etc.)

## 10. Environment Variables (`.env.example`)

```
DATABASE_URL               # Postgres connection (shared across prod and test)
AUTH_SECRET                # NextAuth secret (same on both services)
AUTH_GOOGLE_ID             # Google OAuth (shared client; both redirect URIs registered)
AUTH_GOOGLE_SECRET
ADMIN_USERNAME             # Admin login (credentials provider)
ADMIN_PASSWORD             # Plain-text password (compared directly in auth.ts)
QR_JWT_SECRET              # QR token signing (same on both services so QRs cross-validate)
QR_TOKEN_EXPIRY_SECONDS    # default 180
UPLOAD_DIR                 # default ./public/uploads (Railway: /app/uploads)
MAX_FILE_SIZE_MB           # default 5
TZ                         # Asia/Seoul
NEXT_PUBLIC_SITE_URL       # per-environment: prod=https://meal.posan.kr, test=https://posanmeal.up.railway.app
AUTH_URL                   # per-environment, mirrors NEXT_PUBLIC_SITE_URL
```

## 11. Key Architectural Decisions

1. **JWT QR tokens** (180s, auto-refresh at 30s left) — prevents screenshot reuse
2. **Timezone centralization** — every date goes through `lib/timezone.ts`
3. **Email as sync key** — Google OAuth + Sheets import both upsert by email
4. **Photo pipeline** — sharp resize → 300x300 WebP → Railway volume `/app/uploads`
5. **Meal eligibility via MealRegistration** — QR generation and check-in require an APPROVED MealRegistration whose MealApplication `mealStart`/`mealEnd` window contains today; `eligibleUserIds` is synced to local-db for offline use
6. **Admin = env credentials** (not DB) — `Admin` model is legacy
7. **Homeroom teacher UX** — presence of `User.homeroom` unlocks the "학생관리" tab dynamically

## 12. Docs

- `docs/superpowers/specs/2026-03-28-posanmeal-design.md` — full design spec
- `docs/superpowers/plans/2026-03-28-posanmeal-implementation.md` — step-by-step implementation plan

## 13. Project-Map Maintenance

This map is kept in sync by the **`project-map-keeper`** agent (`.claude/agents/project-map-keeper.md`).

- A `PostToolUse` hook logs every source file edit to `.claude/.project-map-pending.log`.
- A `SessionStart` hook surfaces that log, prompting Claude to invoke the agent.
- **To manually refresh**: ask Claude to run the `project-map-keeper` agent.
- **When to fully regenerate**: dependency upgrades, major refactors, schema migrations — delete this file and ask the agent for a full rebuild.
