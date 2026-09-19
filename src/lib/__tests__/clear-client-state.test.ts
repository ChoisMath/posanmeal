import { afterEach, describe, expect, it, vi } from "vitest";
import { clearClientBrowserState } from "@/lib/clearClientState";
const state = vi.hoisted(() => ({ count: 0, concurrent: false, cleared: false, deleted: [] as string[] }));
vi.mock("next-auth/react", () => ({ signOut: async () => {} }));
vi.mock("@/lib/local-db", async (original) => ({
  ...await original<typeof import("@/lib/local-db")>(),
  getPendingCheckInCounts: async () => ({ unsynced: state.count, review: 0 }),
  clearAllData: async (protection: { exported: unknown[]; scope: string }) => {
    if (state.concurrent) { state.count = 2; throw new Error("내보내기 필요"); }
    if (protection.exported.length || protection.scope !== "PENDING" || state.count) throw new Error("보호되지 않은 초기화");
    state.cleared = true;
  },
}));
afterEach(() => { vi.unstubAllGlobals(); state.count = 0; state.concurrent = false; state.cleared = false; state.deleted = []; });
function browser() {
  vi.stubGlobal("indexedDB", {
    databases: async () => [{ name: "posanmeal-local" }, { name: "other-cache" }],
    deleteDatabase: (name: string) => { state.deleted.push(name); const req: { onsuccess?: () => void } = {}; setTimeout(() => req.onsuccess?.(), 0); return req; },
  });
}
describe("clearClientBrowserState", () => {
  it("0건 조회 이후 동시 체크인이 생기면 원자 초기화를 거절하고 로그아웃용 정리를 마친다", async () => {
    browser(); state.concurrent = true;
    expect(await clearClientBrowserState()).toEqual({ keptCheckIns: 2 });
    expect(state.cleared).toBe(false);
    expect(state.deleted).toEqual(["other-cache"]);
  });
  it("빈 키오스크는 원자 clear 후에도 지연 deleteDatabase 대상에 넣지 않는다", async () => {
    browser();
    expect(await clearClientBrowserState()).toEqual({ keptCheckIns: 0 });
    expect(state.cleared).toBe(true);
    expect(state.deleted).toEqual(["other-cache"]);
  });
  it("이미 미전송이 있으면 명부까지 그대로 남긴다", async () => {
    browser(); state.count = 3;
    expect(await clearClientBrowserState()).toEqual({ keptCheckIns: 3 });
    expect(state.cleared).toBe(false);
    expect(state.deleted).toEqual(["other-cache"]);
  });
});
