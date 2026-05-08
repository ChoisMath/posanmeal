import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  canWriteAdmin: vi.fn(() => true),
  userFindUnique: vi.fn(),
  checkInCreate: vi.fn(),
  mealRegistrationFindFirst: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ canWriteAdmin: mocks.canWriteAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    checkIn: { create: mocks.checkInCreate },
    mealRegistration: { findFirst: mocks.mealRegistrationFindFirst },
  },
}));

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/sync/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sync/upload — local-mode sync preserves IDB-saved check-ins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWriteAdmin.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ user: { dbUserId: 1, adminLevel: "ADMIN" } });
  });

  it("inserts a student check-in without re-validating meal registration", async () => {
    const { POST } = await import("@/app/api/sync/upload/route");
    mocks.userFindUnique.mockResolvedValue({ id: 42 });
    mocks.checkInCreate.mockResolvedValue({ id: 1 });

    const res = await POST(
      buildRequest({
        checkins: [
          {
            clientId: 7,
            userId: 42,
            date: "2026-05-08",
            mealKind: "DINNER",
            checkedAt: "2026-05-08T10:30:00.000Z",
            type: "STUDENT",
          },
        ],
      }),
    );
    const body = await res.json();

    expect(mocks.mealRegistrationFindFirst).not.toHaveBeenCalled();
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 42,
          mealKind: "DINNER",
          source: "LOCAL_SYNC",
        }),
      }),
    );
    expect(body.acceptedCount).toBe(1);
    expect(body.duplicatesCount).toBe(0);
    expect(body.rejectedCount).toBe(0);
    expect(body.syncedClientIds).toEqual([7]);
    expect(body.rejected).toEqual([]);
  });

  it("treats P2002 unique-violation as a duplicate that the client may safely mark synced", async () => {
    const { POST } = await import("@/app/api/sync/upload/route");
    mocks.userFindUnique.mockResolvedValue({ id: 42 });
    mocks.checkInCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    const res = await POST(
      buildRequest({
        checkins: [
          {
            clientId: 11,
            userId: 42,
            date: "2026-05-08",
            mealKind: "DINNER",
            checkedAt: "2026-05-08T10:30:00.000Z",
            type: "STUDENT",
          },
        ],
      }),
    );
    const body = await res.json();

    expect(body.acceptedCount).toBe(0);
    expect(body.duplicatesCount).toBe(1);
    expect(body.rejectedCount).toBe(0);
    expect(body.syncedClientIds).toEqual([11]);
  });

  it("rejects USER_NOT_FOUND without marking the client id as synced", async () => {
    const { POST } = await import("@/app/api/sync/upload/route");
    mocks.userFindUnique.mockResolvedValue(null);

    const res = await POST(
      buildRequest({
        checkins: [
          {
            clientId: 99,
            userId: 9999,
            date: "2026-05-08",
            mealKind: "DINNER",
            checkedAt: "2026-05-08T10:30:00.000Z",
            type: "STUDENT",
          },
        ],
      }),
    );
    const body = await res.json();

    expect(mocks.checkInCreate).not.toHaveBeenCalled();
    expect(body.acceptedCount).toBe(0);
    expect(body.duplicatesCount).toBe(0);
    expect(body.rejectedCount).toBe(1);
    expect(body.syncedClientIds).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({ clientId: 99, userId: 9999, reason: "USER_NOT_FOUND" }),
    ]);
  });

  it("classifies non-P2002 prisma errors as SERVER_ERROR rejected items so the client retries them", async () => {
    const { POST } = await import("@/app/api/sync/upload/route");
    mocks.userFindUnique.mockResolvedValue({ id: 42 });
    mocks.checkInCreate.mockRejectedValue(new Error("connection lost"));

    const res = await POST(
      buildRequest({
        checkins: [
          {
            clientId: 5,
            userId: 42,
            date: "2026-05-08",
            mealKind: "DINNER",
            checkedAt: "2026-05-08T10:30:00.000Z",
            type: "STUDENT",
          },
        ],
      }),
    );
    const body = await res.json();

    expect(body.acceptedCount).toBe(0);
    expect(body.rejectedCount).toBe(1);
    expect(body.syncedClientIds).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({ clientId: 5, reason: "SERVER_ERROR" }),
    ]);
  });

  it("processes a mixed batch and reports per-item results", async () => {
    const { POST } = await import("@/app/api/sync/upload/route");
    mocks.userFindUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(where.id === 9999 ? null : { id: where.id }),
    );
    mocks.checkInCreate
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));

    const res = await POST(
      buildRequest({
        checkins: [
          { clientId: 1, userId: 1, date: "2026-05-08", mealKind: "DINNER", checkedAt: "2026-05-08T10:30:00.000Z", type: "STUDENT" },
          { clientId: 2, userId: 2, date: "2026-05-08", mealKind: "DINNER", checkedAt: "2026-05-08T10:30:00.000Z", type: "STUDENT" },
          { clientId: 3, userId: 9999, date: "2026-05-08", mealKind: "DINNER", checkedAt: "2026-05-08T10:30:00.000Z", type: "STUDENT" },
        ],
      }),
    );
    const body = await res.json();

    expect(body.acceptedCount).toBe(1);
    expect(body.duplicatesCount).toBe(1);
    expect(body.rejectedCount).toBe(1);
    expect(body.syncedClientIds.slice().sort()).toEqual([1, 2]);
    expect(body.rejected).toEqual([
      expect.objectContaining({ clientId: 3, userId: 9999, reason: "USER_NOT_FOUND" }),
    ]);
  });

  it("returns 403 for non-admin sessions without touching prisma", async () => {
    mocks.canWriteAdmin.mockReturnValue(false);
    const { POST } = await import("@/app/api/sync/upload/route");

    const res = await POST(buildRequest({ checkins: [{ clientId: 1, userId: 1, date: "2026-05-08", mealKind: "DINNER", checkedAt: "2026-05-08T10:30:00.000Z", type: "STUDENT" }] }));

    expect(res.status).toBe(403);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("handles empty payload as a no-op", async () => {
    const { POST } = await import("@/app/api/sync/upload/route");

    const res = await POST(buildRequest({ checkins: [] }));
    const body = await res.json();

    expect(body.acceptedCount).toBe(0);
    expect(body.duplicatesCount).toBe(0);
    expect(body.rejectedCount).toBe(0);
    expect(body.syncedClientIds).toEqual([]);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });
});
