import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    mealRegistrationMealDate: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

type FakeUser = {
  id: number;
  role: "STUDENT" | "TEACHER";
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
  accessState: string;
  sessionVersion: number;
};

function fakeDb(user: FakeUser | null) {
  return { user: { findUnique: async () => user } } as never;
}

const ACTIVE_TEACHER: FakeUser = {
  id: 7,
  role: "TEACHER",
  adminLevel: "ADMIN",
  accessState: "ACTIVE",
  sessionVersion: 3,
};

const userActor = (sessionVersion: number) =>
  ({ kind: "USER", userId: 7, sessionVersion }) as const;
const MAIN = { kind: "MAIN", userId: null, sessionVersion: null } as const;

describe("assertActor", () => {
  it("rejects a user whose row disappeared", async () => {
    const { assertActor } = await import("@/lib/academic-year/access");
    await expect(assertActor(fakeDb(null), userActor(3), "SIGNED_IN")).rejects.toMatchObject({
      code: "ACCOUNT_INACTIVE",
    });
  });

  it("rejects an INACTIVE user before looking at the session version", async () => {
    const { assertActor } = await import("@/lib/academic-year/access");
    const db = fakeDb({ ...ACTIVE_TEACHER, accessState: "INACTIVE" });
    await expect(assertActor(db, userActor(3), "SIGNED_IN")).rejects.toMatchObject({
      code: "ACCOUNT_INACTIVE",
    });
  });

  it("rejects a token minted before the session version was bumped", async () => {
    const { assertActor } = await import("@/lib/academic-year/access");
    await expect(assertActor(fakeDb(ACTIVE_TEACHER), userActor(2), "SIGNED_IN")).rejects.toMatchObject({
      code: "STALE_SESSION",
    });
  });

  it("never lets a signed-in user reach a MAIN-only operation", async () => {
    const { assertActor } = await import("@/lib/academic-year/access");
    await expect(assertActor(fakeDb(ACTIVE_TEACHER), userActor(3), "MAIN")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("uses the stored admin level, not the token, for admin requirements", async () => {
    const { assertActor } = await import("@/lib/academic-year/access");
    const sub = fakeDb({ ...ACTIVE_TEACHER, adminLevel: "SUBADMIN" });
    await expect(assertActor(sub, userActor(3), "READ_ADMIN")).resolves.toBeUndefined();
    await expect(assertActor(sub, userActor(3), "WRITE_ADMIN")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      assertActor(fakeDb(ACTIVE_TEACHER), userActor(3), "WRITE_ADMIN"),
    ).resolves.toBeUndefined();
  });

  it("separates STUDENT and TEACHER requirements by the stored role", async () => {
    const { assertActor } = await import("@/lib/academic-year/access");
    await expect(assertActor(fakeDb(ACTIVE_TEACHER), userActor(3), "TEACHER")).resolves.toBeUndefined();
    await expect(assertActor(fakeDb(ACTIVE_TEACHER), userActor(3), "STUDENT")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets the credentials main admin through admin gates but not self-service gates", async () => {
    const { assertActor } = await import("@/lib/academic-year/access");
    const db = fakeDb(null);
    await expect(assertActor(db, MAIN, "MAIN")).resolves.toBeUndefined();
    await expect(assertActor(db, MAIN, "WRITE_ADMIN")).resolves.toBeUndefined();
    await expect(assertActor(db, MAIN, "STUDENT")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertActor(db, MAIN, "TEACHER")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requireActor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    const { requireActor } = await import("@/lib/academic-year/request-actor");
    await expect(requireActor("SIGNED_IN")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("forces a re-login for an existing Google session without a sessionVersion claim", async () => {
    mocks.auth.mockResolvedValue({ user: { dbUserId: 7, role: "TEACHER", adminLevel: "ADMIN" } });
    const { requireActor } = await import("@/lib/academic-year/request-actor");
    await expect(requireActor("SIGNED_IN")).rejects.toMatchObject({ code: "STALE_SESSION" });
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("maps the credentials admin session to the MAIN actor without a DB row", async () => {
    mocks.auth.mockResolvedValue({ user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } });
    const { requireActor } = await import("@/lib/academic-year/request-actor");
    await expect(requireActor("MAIN")).resolves.toEqual({
      kind: "MAIN",
      userId: null,
      sessionVersion: null,
    });
  });

  it("re-validates a Google session against the current row", async () => {
    mocks.auth.mockResolvedValue({
      user: { dbUserId: 7, role: "TEACHER", adminLevel: "ADMIN", sessionVersion: 3 },
    });
    mocks.userFindUnique.mockResolvedValue(ACTIVE_TEACHER);
    const { requireActor } = await import("@/lib/academic-year/request-actor");
    await expect(requireActor("WRITE_ADMIN")).resolves.toEqual({
      kind: "USER",
      userId: 7,
      sessionVersion: 3,
    });
  });

  it("refuses a session whose stored admin level was revoked, even if the token still says ADMIN", async () => {
    mocks.auth.mockResolvedValue({
      user: { dbUserId: 7, role: "TEACHER", adminLevel: "ADMIN", sessionVersion: 3 },
    });
    mocks.userFindUnique.mockResolvedValue({ ...ACTIVE_TEACHER, adminLevel: "NONE" });
    const { requireActor } = await import("@/lib/academic-year/request-actor");
    await expect(requireActor("READ_ADMIN")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("domain error to HTTP mapping", () => {
  it("maps every domain code to the agreed status", async () => {
    const { domainErrorStatus } = await import("@/lib/academic-year/api");
    expect(domainErrorStatus("UNAUTHENTICATED")).toBe(401);
    expect(domainErrorStatus("STALE_SESSION")).toBe(401);
    expect(domainErrorStatus("FORBIDDEN")).toBe(403);
    expect(domainErrorStatus("ACCOUNT_INACTIVE")).toBe(403);
    expect(domainErrorStatus("VERSION_CONFLICT")).toBe(409);
    expect(domainErrorStatus("REQUEST_REUSED")).toBe(409);
    expect(domainErrorStatus("IDENTITY_CONFLICT")).toBe(409);
    expect(domainErrorStatus("INVALID_FILE")).toBe(422);
    expect(domainErrorStatus("YEAR_MISMATCH")).toBe(422);
    expect(domainErrorStatus("REVIEW_REQUIRED")).toBe(422);
    expect(domainErrorStatus("MISSING_PROFILE")).toBe(422);
    expect(domainErrorStatus("NOT_READY")).toBe(503);
  });

  it("returns the agreed body shape and hides unexpected errors", async () => {
    const { errorResponse } = await import("@/lib/academic-year/api");
    const { DomainError } = await import("@/lib/academic-year/errors");

    const denied = errorResponse(new DomainError("FORBIDDEN", "권한이 없습니다."));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: "FORBIDDEN", message: "권한이 없습니다." } });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = errorResponse(new Error('duplicate key value violates unique constraint "User_email_key"'));
    spy.mockRestore();
    expect(raw.status).toBe(500);
    expect(JSON.stringify(await raw.json())).not.toContain("User_email_key");
  });
});

describe("normalizeEmail", () => {
  it("only folds whitespace and case", async () => {
    const { normalizeEmail } = await import("@/lib/academic-year/profile-schema");
    expect(normalizeEmail("  Student.One+Tag@Posan.KR ")).toBe("student.one+tag@posan.kr");
    expect(normalizeEmail("a.b@gmail.com")).toBe("a.b@gmail.com");
    expect(normalizeEmail("ab@gmail.com")).not.toBe(normalizeEmail("a.b@gmail.com"));
  });
});

describe("public path allowlist", () => {
  it("matches on a path boundary so /api/checkins is not public", async () => {
    const { isPublicPath } = await import("@/lib/public-paths");
    expect(isPublicPath("/api/checkin")).toBe(true);
    expect(isPublicPath("/api/checkins")).toBe(false);
    expect(isPublicPath("/api/facecheck")).toBe(true);
    expect(isPublicPath("/api/sync/download")).toBe(true);
    expect(isPublicPath("/api/system/settings")).toBe(true);
    expect(isPublicPath("/api/mealsomething")).toBe(false);
    expect(isPublicPath("/api/uploads/12.webp")).toBe(true);
    expect(isPublicPath("/api/authorize")).toBe(false);
    expect(isPublicPath("/checkin")).toBe(false);
    expect(isPublicPath("/check")).toBe(true);
    expect(isPublicPath("/admin/login")).toBe(true);
    expect(isPublicPath("/admin")).toBe(false);
  });
});

describe("/api/users/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { dbUserId: 7, role: "TEACHER", adminLevel: "ADMIN", sessionVersion: 3 },
    });
    mocks.userFindUnique.mockResolvedValue(ACTIVE_TEACHER);
  });

  it("exports no PUT — every field it used to accept is roster-owned, so PUT answers 405", async () => {
    const route = await import("@/app/api/users/me/route");
    expect(route).not.toHaveProperty("PUT");
    expect(Object.keys(route)).toEqual(["GET"]);
  });

  it("GET returns the profile with today's meals", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(ACTIVE_TEACHER).mockResolvedValueOnce({
      id: 7,
      email: "teacher@example.posan.kr",
      name: "교사",
      role: "TEACHER",
      homeroom: "1-1",
      photoUrl: null,
    });
    const { GET } = await import("@/app/api/users/me/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: 7, todayMeals: [] } });
  });

  it("GET refuses an unauthenticated request", async () => {
    mocks.auth.mockResolvedValue(null);
    const { GET } = await import("@/app/api/users/me/route");
    expect((await GET()).status).toBe(401);
  });
});
