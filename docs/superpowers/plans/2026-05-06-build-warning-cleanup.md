# Build Warning Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining Next.js 16 build warnings: deprecated `middleware.ts` convention and broad filesystem tracing from the uploaded-photo route.

**Architecture:** Keep auth routing behavior unchanged while migrating the file convention from Middleware to Proxy. Stop serving uploaded images by reading arbitrary filesystem paths in a Route Handler; uploaded profile images are written under `public/uploads` and served as static assets, with `/api/uploads/[filename]` retained as a compatibility redirect for existing `photoUrl` values.

**Tech Stack:** Next.js 16.2.1 App Router, Auth.js middleware wrapper, Node.js route handlers, Vitest, Turbopack build.

---

## Current Evidence

- `npm.cmd run build` succeeds but warns that the `middleware` file convention is deprecated and should be replaced with `proxy`.
- The same build warns that `src/app/api/uploads/[filename]/route.ts` causes an unexpected NFT trace because `readFile(path.join(UPLOAD_DIR, safeName))` uses a dynamic filesystem path.
- Next local docs confirm that Next.js 16 renamed Middleware to Proxy and supports `src/proxy.ts`.
- Current uploads are written to `./public/uploads` and exposed through `/api/uploads/${filename}?t=...`.

## File Structure

- Rename: `src/middleware.ts` -> `src/proxy.ts`
  - Responsibility: central request pre-filter for auth and role redirects.
- Modify: `src/app/api/uploads/[filename]/route.ts`
  - Responsibility: compatibility redirect from old API image URLs to static `/uploads/<filename>`.
- Modify: `src/app/api/users/me/photo/route.ts`
  - Responsibility: write/delete profile images in `public/uploads` and return static public URLs for new uploads.
- Modify: `.env.example`
  - Responsibility: remove `UPLOAD_DIR` as a configurable public image storage root if the implementation chooses static public serving.
- Create: `src/lib/__tests__/next-build-warnings.test.ts`
  - Responsibility: source-level regression tests for the two warning classes.

---

### Task 1: Add a Failing Test for Next 16 Build Conventions

**Files:**
- Create: `src/lib/__tests__/next-build-warnings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Next build warning guardrails", () => {
  it("uses proxy.ts instead of the deprecated middleware.ts convention", () => {
    expect(existsSync(join(root, "src/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "src/proxy.ts"))).toBe(true);

    const proxySource = readFileSync(join(root, "src/proxy.ts"), "utf8");
    expect(proxySource).not.toContain("export const runtime");
    expect(proxySource).toContain("matcher");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/lib/__tests__/next-build-warnings.test.ts`

Expected: FAIL because `src/middleware.ts` exists and `src/proxy.ts` does not exist.

- [ ] **Step 3: Commit the failing test**

```powershell
git add -- src/lib/__tests__/next-build-warnings.test.ts
git commit -m "test: guard Next build warning conventions"
```

---

### Task 2: Migrate Middleware to Proxy

**Files:**
- Rename: `src/middleware.ts` -> `src/proxy.ts`
- Test: `src/lib/__tests__/next-build-warnings.test.ts`

- [ ] **Step 1: Rename the file**

Run: `git mv src/middleware.ts src/proxy.ts`

Do not change the auth logic or matcher. Remove any `runtime` route segment export because Next 16 Proxy always runs on the Node.js runtime and rejects route segment config in `proxy.ts`. The current default export is acceptable because the Next 16 Proxy docs allow a default proxy export.

- [ ] **Step 2: Run the convention test**

Run: `npm.cmd test -- src/lib/__tests__/next-build-warnings.test.ts`

Expected: PASS for the proxy convention test.

- [ ] **Step 3: Run a build checkpoint**

Run: `npm.cmd run build`

Expected: the `middleware` deprecation warning is gone. The upload route NFT warning may still remain until Task 4.

- [ ] **Step 4: Commit**

```powershell
git add -- src/proxy.ts src/middleware.ts src/lib/__tests__/next-build-warnings.test.ts
git commit -m "fix: migrate middleware convention to proxy"
```

---

### Task 3: Add a Failing Test for Upload Route Filesystem Tracing

**Files:**
- Modify: `src/lib/__tests__/next-build-warnings.test.ts`

- [ ] **Step 1: Extend the test file**

Append this test inside the existing `describe` block:

```ts
  it("serves uploaded photos through public assets instead of filesystem reads in the GET route", () => {
    const uploadRouteSource = readFileSync(
      join(root, "src/app/api/uploads/[filename]/route.ts"),
      "utf8",
    );
    const photoRouteSource = readFileSync(
      join(root, "src/app/api/users/me/photo/route.ts"),
      "utf8",
    );

    expect(uploadRouteSource).not.toContain("readFile");
    expect(uploadRouteSource).toContain("NextResponse.redirect");
    expect(uploadRouteSource).toContain('new URL(`/uploads/${safeName}`, request.url)');
    expect(photoRouteSource).toContain('const photoUrl = `/uploads/${filename}?t=${Date.now()}`;');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/lib/__tests__/next-build-warnings.test.ts`

Expected: FAIL because the current GET route imports `readFile` and the upload POST route returns `/api/uploads/...`.

- [ ] **Step 3: Commit the failing test**

```powershell
git add -- src/lib/__tests__/next-build-warnings.test.ts
git commit -m "test: guard upload route tracing behavior"
```

---

### Task 4: Replace Upload File Reads with Static Public Serving

**Files:**
- Modify: `src/app/api/uploads/[filename]/route.ts`
- Modify: `src/app/api/users/me/photo/route.ts`
- Modify: `.env.example`
- Test: `src/lib/__tests__/next-build-warnings.test.ts`

- [ ] **Step 1: Replace `src/app/api/uploads/[filename]/route.ts`**

Use this complete file:

```ts
import { NextResponse } from "next/server";
import path from "node:path";

const SAFE_UPLOAD_NAME = /^[A-Za-z0-9._-]+$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const safeName = path.basename(filename);

  if (safeName !== filename || !SAFE_UPLOAD_NAME.test(safeName)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  return NextResponse.redirect(new URL(`/uploads/${safeName}`, request.url));
}
```

- [ ] **Step 2: Update `src/app/api/users/me/photo/route.ts` upload directory and returned URL**

Change the imports and constants to:

```ts
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || "5")) * 1024 * 1024;
```

Change the upload response URL to:

```ts
const photoUrl = `/uploads/${filename}?t=${Date.now()}`;
```

Keep the DELETE path as:

```ts
const filepath = path.join(UPLOAD_DIR, filename);
```

- [ ] **Step 3: Update `.env.example`**

Replace the file upload section with:

```dotenv
# File Upload
# Profile images are stored under public/uploads and served as static assets.
MAX_FILE_SIZE_MB=5
```

- [ ] **Step 4: Run the warning guard test**

Run: `npm.cmd test -- src/lib/__tests__/next-build-warnings.test.ts`

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run: `npm.cmd test`

Expected: all Vitest tests pass.

- [ ] **Step 6: Run build and verify both warnings are gone**

Run: `npm.cmd run build`

Expected:
- Build exits with code 0.
- Output does not contain `The "middleware" file convention is deprecated`.
- Output does not contain `Encountered unexpected file in NFT list`.

- [ ] **Step 7: Commit**

```powershell
git add -- src/app/api/uploads/[filename]/route.ts src/app/api/users/me/photo/route.ts .env.example src/lib/__tests__/next-build-warnings.test.ts
git commit -m "fix: serve uploaded photos from public assets"
```

---

### Task 5: Final Verification and Merge Readiness

**Files:**
- No source edits expected.

- [ ] **Step 1: Confirm working tree scope**

Run: `git status --short`

Expected: only intentional files from Tasks 1-4 are committed. Existing unrelated `.claude/.project-map-pending.log` may remain unstaged and should not be included.

- [ ] **Step 2: Run final verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected:
- `npm.cmd test`: 0 failures.
- `npm.cmd run build`: exit 0 and no warning text for deprecated middleware or NFT tracing.

- [ ] **Step 3: Commit or merge according to branch policy**

If this work is on a feature branch:

```powershell
git checkout main
git merge <feature-branch>
npm.cmd test
npm.cmd run build
```

Expected: merged `main` has passing tests and a warning-free build.

---

## Self-Review

- Spec coverage: both current build warnings have a task, a regression guard, implementation steps, and build verification.
- Placeholder scan: no TBD/TODO/fill-in steps remain.
- Type consistency: route handler signatures use the existing Next 16 `params: Promise<{ filename: string }>` pattern already present in this repo.
