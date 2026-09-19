import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchWithSessionRecovery: vi.fn() }));

vi.mock("@/lib/session-recovery", () => ({
  fetchWithSessionRecovery: mocks.fetchWithSessionRecovery,
}));

describe("fetcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes a stale-session 401 through the recovery helper", async () => {
    const body = { error: { code: "STALE_SESSION", message: "로그인 정보가 만료되었습니다." } };
    mocks.fetchWithSessionRecovery.mockResolvedValue(
      new Response(JSON.stringify(body), { status: 401, headers: { "Content-Type": "application/json" } }),
    );

    const { fetcher } = await import("@/lib/fetcher");
    await expect(fetcher("/api/users/me")).rejects.toMatchObject({ status: 401, info: body });

    expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledWith("/api/users/me");
    expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledTimes(1);
  });

  it("returns the parsed body on success", async () => {
    mocks.fetchWithSessionRecovery.mockResolvedValue(
      new Response(JSON.stringify({ users: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { fetcher } = await import("@/lib/fetcher");
    await expect(fetcher("/api/admin/users")).resolves.toEqual({ users: [] });
  });
});
