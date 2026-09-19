import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  changeEmail: vi.fn(),
  changeAccess: vi.fn(),
  changePermissions: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock("@/lib/academic-year/account-service", () => ({
  changeEmail: mocks.changeEmail,
  changeAccess: mocks.changeAccess,
  changePermissions: mocks.changePermissions,
}));

const RECEIPT = { requestId: "req-1", version: 2, changed: 1 };

const MAIN_SESSION = { user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } };
const TEACHER_ADMIN_SESSION = {
  user: { dbUserId: 7, role: "TEACHER", adminLevel: "ADMIN", sessionVersion: 3 },
};
const TEACHER_ADMIN_ROW = {
  role: "TEACHER",
  adminLevel: "ADMIN",
  accessState: "ACTIVE",
  sessionVersion: 3,
};

function putRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function expectedHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("/api/admin/users/[id] account routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(MAIN_SESSION);
    mocks.userFindUnique.mockResolvedValue(TEACHER_ADMIN_ROW);
    mocks.changeEmail.mockResolvedValue(RECEIPT);
    mocks.changeAccess.mockResolvedValue(RECEIPT);
    mocks.changePermissions.mockResolvedValue(RECEIPT);
  });

  it("checks the actor before the service on every route", async () => {
    mocks.auth.mockResolvedValue(null);

    const email = await import("@/app/api/admin/users/[id]/email/route");
    const access = await import("@/app/api/admin/users/[id]/access/route");
    const permissions = await import("@/app/api/admin/users/[id]/permissions/route");

    const responses = await Promise.all([
      email.PUT(putRequest("/api/admin/users/9/email", { requestId: "r", expectedRowVersion: 0, email: "a@b.kr" }), params("9")),
      access.PUT(putRequest("/api/admin/users/9/access", { requestId: "r", expectedRowVersion: 0, state: "INACTIVE", reason: "RETIRED" }), params("9")),
      permissions.PUT(putRequest("/api/admin/users/9/permissions", { requestId: "r", expectedRowVersion: 0, level: "NONE" }), params("9")),
    ]);

    expect(responses.map((res) => res.status)).toEqual([401, 401, 401]);
    expect(mocks.changeEmail).not.toHaveBeenCalled();
    expect(mocks.changeAccess).not.toHaveBeenCalled();
    expect(mocks.changePermissions).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric id from the awaited params", async () => {
    const { PUT } = await import("@/app/api/admin/users/[id]/access/route");
    const res = await PUT(
      putRequest("/api/admin/users/abc/access", {
        requestId: "r",
        expectedRowVersion: 0,
        state: "INACTIVE",
        reason: "RETIRED",
      }),
      params("abc"),
    );
    expect(res.status).toBe(422);
    expect(mocks.changeAccess).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied actor, adminLevel and payloadHash", async () => {
    const { PUT } = await import("@/app/api/admin/users/[id]/permissions/route");
    const res = await PUT(
      putRequest("/api/admin/users/9/permissions", {
        requestId: "r",
        expectedRowVersion: 0,
        level: "SUBADMIN",
        actor: { kind: "MAIN", userId: null, sessionVersion: null },
        adminLevel: "ADMIN",
        payloadHash: "attacker-supplied",
      }),
      params("9"),
    );

    expect(res.status).toBe(200);
    expect(mocks.changePermissions).toHaveBeenCalledTimes(1);
    const input = mocks.changePermissions.mock.calls[0][1];
    expect(input.actor).toEqual({ kind: "MAIN", userId: null, sessionVersion: null });
    expect(input.payloadHash).toBe(expectedHash({ userId: 9, level: "SUBADMIN" }));
    expect(input.userId).toBe(9);
  });

  it("derives the actor from the session, not the body, for a signed-in admin", async () => {
    mocks.auth.mockResolvedValue(TEACHER_ADMIN_SESSION);
    const { PUT } = await import("@/app/api/admin/users/[id]/email/route");
    const res = await PUT(
      putRequest("/api/admin/users/9/email", {
        requestId: "r",
        expectedRowVersion: 0,
        email: "New.One@Example.KR",
        actor: { kind: "MAIN", userId: null, sessionVersion: null },
      }),
      params("9"),
    );

    expect(res.status).toBe(200);
    const input = mocks.changeEmail.mock.calls[0][1];
    expect(input.actor).toEqual({ kind: "USER", userId: 7, sessionVersion: 3 });
    expect(input.payloadHash).toBe(expectedHash({ userId: 9, email: "New.One@Example.KR" }));
  });

  it("refuses a teacher with ADMIN level on the permissions route before the service runs", async () => {
    mocks.auth.mockResolvedValue(TEACHER_ADMIN_SESSION);
    const { PUT } = await import("@/app/api/admin/users/[id]/permissions/route");
    const res = await PUT(
      putRequest("/api/admin/users/9/permissions", { requestId: "r", expectedRowVersion: 0, level: "ADMIN" }),
      params("9"),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(mocks.changePermissions).not.toHaveBeenCalled();
  });

  it("passes a reactivation by a teacher-ADMIN to the service and maps its refusal to 403", async () => {
    const { DomainError } = await import("@/lib/academic-year/errors");
    mocks.auth.mockResolvedValue(TEACHER_ADMIN_SESSION);
    mocks.changeAccess.mockRejectedValue(new DomainError("FORBIDDEN", "메인 관리자만 할 수 있는 작업입니다."));

    const { PUT } = await import("@/app/api/admin/users/[id]/access/route");
    const res = await PUT(
      putRequest("/api/admin/users/9/access", {
        requestId: "r",
        expectedRowVersion: 0,
        state: "ACTIVE",
        reason: "REHIRED",
        confirmPrivileges: true,
      }),
      params("9"),
    );

    expect(res.status).toBe(403);
    expect(mocks.changeAccess.mock.calls[0][1].actor).toEqual({
      kind: "USER",
      userId: 7,
      sessionVersion: 3,
    });
  });
});
