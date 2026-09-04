import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  canWriteAdmin: vi.fn(() => true),
  systemSettingFindMany: vi.fn(),
  userFindMany: vi.fn(),
  mealDateFindMany: vi.fn(),
  faceProfileFindMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ canWriteAdmin: mocks.canWriteAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { findMany: mocks.systemSettingFindMany },
    user: { findMany: mocks.userFindMany },
    mealRegistrationMealDate: { findMany: mocks.mealDateFindMany },
    faceProfile: { findMany: mocks.faceProfileFindMany },
  },
}));

describe("/api/sync/download — faces=1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWriteAdmin.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ user: { adminLevel: "ADMIN" } });
    mocks.systemSettingFindMany.mockResolvedValue([
      { key: "operationMode", value: "local" },
      { key: "face_match_threshold", value: "0.6" },
    ]);
    mocks.userFindMany.mockResolvedValue([
      { id: 1, name: "김학생", role: "STUDENT", grade: 1, classNum: 2, number: 3 },
    ]);
    mocks.mealDateFindMany.mockResolvedValue([]);
    mocks.faceProfileFindMany.mockResolvedValue([{ userId: 1, embeddings: [[0.1, 0.2]] }]);
  });

  it("faces=1이면 faceProfiles·faceMatch 포함 (threshold는 설정값, margin은 기본값)", async () => {
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download?faces=1"));
    const body = await res.json();
    expect(body.faceProfiles).toEqual([{ userId: 1, embeddings: [[0.1, 0.2]] }]);
    expect(body.faceMatch).toEqual({ threshold: 0.6, margin: 0.05 });
    expect(mocks.faceProfileFindMany).toHaveBeenCalledTimes(1);
  });

  it("faces 없음 → faceProfiles 조회·포함 안 함 (기존 /check 페이로드 불변)", async () => {
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download"));
    const body = await res.json();
    expect(body.faceProfiles).toBeUndefined();
    expect(body.faceMatch).toBeUndefined();
    expect(mocks.faceProfileFindMany).not.toHaveBeenCalled();
    expect(body.users).toHaveLength(1);
  });

  it("권한 없음 → 403", async () => {
    mocks.canWriteAdmin.mockReturnValue(false);
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download?faces=1"));
    expect(res.status).toBe(403);
  });
});
