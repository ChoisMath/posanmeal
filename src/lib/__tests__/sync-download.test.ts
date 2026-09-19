import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  systemSettingFindMany: vi.fn(),
  userFindMany: vi.fn(),
  mealDateFindMany: vi.fn(),
  faceProfileFindMany: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { findMany: mocks.systemSettingFindMany },
    user: { findMany: mocks.userFindMany },
    mealRegistrationMealDate: { findMany: mocks.mealDateFindMany },
    faceProfile: { findMany: mocks.faceProfileFindMany },
    // Release A(PREPARING)에서는 근거를 만들지 않고 기존 페이로드를 그대로 낸다.
    $queryRaw: () => Promise.resolve([{ mode: "PREPARING" }]),
    $executeRaw: mocks.executeRaw,
  },
}));

describe("/api/sync/download — faces=1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRaw.mockResolvedValue(0);
    mocks.auth.mockResolvedValue({ user: { role: "ADMIN", dbUserId: 0, adminLevel: "ADMIN" } });
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
    expect(mocks.faceProfileFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { modelVersion: FACE_MODEL_VERSION, user: { accessState: "ACTIVE" } },
      }),
    );
  });

  it("PREPARING에서는 snapshot 없이 기존 필드만 내려준다", async () => {
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download"));
    const body = await res.json();
    expect(body.snapshot).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual([
      "eligibleEntries", "eligibleUserIds", "mealWindows", "operationMode",
      "qrGeneration", "serverTime", "users",
    ]);
  });

  it("이용이 중지된 계정은 명단에서 제외한다", async () => {
    const { GET } = await import("@/app/api/sync/download/route");
    await GET(new Request("http://localhost/api/sync/download"));
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accessState: "ACTIVE" } }),
    );
  });

  it("보존 정리가 실패해도 동기화 응답은 200이다", async () => {
    mocks.executeRaw.mockRejectedValue(new Error("purge down"));
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download"));
    expect(res.status).toBe(200);
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

  it("미인증 → 401, 응답 모양은 기존과 같다", async () => {
    mocks.auth.mockResolvedValue(null);
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download?faces=1"));
    expect(res.status).toBe(401);
    expect(typeof (await res.json()).error).toBe("string");
  });
});
