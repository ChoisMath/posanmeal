import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACE_EMBEDDING_DIM } from "@/lib/face-constants";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  faceProfileFindUnique: vi.fn(),
  faceProfileUpsert: vi.fn(),
  faceProfileDeleteMany: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    faceProfile: {
      findUnique: mocks.faceProfileFindUnique,
      upsert: mocks.faceProfileUpsert,
      deleteMany: mocks.faceProfileDeleteMany,
    },
  },
}));

const validEmbedding = Array.from({ length: FACE_EMBEDDING_DIM }, () => 0.1);

function postRequest(body: unknown) {
  return new Request("http://localhost/api/users/me/face", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/users/me/face", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { dbUserId: 42, role: "STUDENT", adminLevel: "NONE", sessionVersion: 5 },
    });
    mocks.userFindUnique.mockResolvedValue({
      role: "STUDENT",
      adminLevel: "NONE",
      accessState: "ACTIVE",
      sessionVersion: 5,
    });
  });

  it("비로그인 401", async () => {
    mocks.auth.mockResolvedValue(null);
    const { GET } = await import("@/app/api/users/me/face/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("이용이 중지된 계정은 403", async () => {
    mocks.userFindUnique.mockResolvedValue({
      role: "STUDENT",
      adminLevel: "NONE",
      accessState: "INACTIVE",
      sessionVersion: 5,
    });
    const { GET } = await import("@/app/api/users/me/face/route");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "ACCOUNT_INACTIVE" } });
  });

  it("세션 세대가 어긋나면 401", async () => {
    mocks.userFindUnique.mockResolvedValue({
      role: "STUDENT",
      adminLevel: "NONE",
      accessState: "ACTIVE",
      sessionVersion: 6,
    });
    const { DELETE } = await import("@/app/api/users/me/face/route");
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(mocks.faceProfileDeleteMany).not.toHaveBeenCalled();
  });

  it("GET: 등록 없으면 registered=false", async () => {
    mocks.faceProfileFindUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/users/me/face/route");
    const body = await (await GET()).json();
    expect(body.registered).toBe(false);
  });

  it("POST: 유효 바디 → userId 42로 upsert", async () => {
    mocks.faceProfileUpsert.mockResolvedValue({ id: 1 });
    const { POST } = await import("@/app/api/users/me/face/route");
    const res = await POST(
      postRequest({
        embeddings: [validEmbedding, validEmbedding, validEmbedding],
        consentVersion: "2026-09-v1",
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.faceProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42 } }),
    );
  });

  it("POST: 잘못된 바디 400", async () => {
    const { POST } = await import("@/app/api/users/me/face/route");
    const res = await POST(postRequest({ embeddings: [[1, 2]], consentVersion: "v" }));
    expect(res.status).toBe(400);
    expect(mocks.faceProfileUpsert).not.toHaveBeenCalled();
  });

  it("POST: 구버전 consentVersion 400, upsert 미호출", async () => {
    const { POST } = await import("@/app/api/users/me/face/route");
    const res = await POST(
      postRequest({
        embeddings: [validEmbedding, validEmbedding, validEmbedding],
        consentVersion: "old",
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.faceProfileUpsert).not.toHaveBeenCalled();
  });

  it("DELETE: 본인 프로필 삭제", async () => {
    mocks.faceProfileDeleteMany.mockResolvedValue({ count: 1 });
    const { DELETE } = await import("@/app/api/users/me/face/route");
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mocks.faceProfileDeleteMany).toHaveBeenCalledWith({ where: { userId: 42 } });
  });
});
