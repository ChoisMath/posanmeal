import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRolloverController } from "@/lib/admin-roster/rollover-controller";
import { requestJson, sendMutation, type MutationResult } from "@/lib/admin-roster/mutate";
import type { MutationReceipt } from "@/lib/academic-year/contracts";
import type { RolloverReview } from "@/lib/academic-year/rollover-service";

vi.mock("@/lib/admin-roster/mutate", () => ({ requestJson: vi.fn(), sendMutation: vi.fn() }));
const request = vi.mocked(requestJson);
const mutate = vi.mocked(sendMutation);
const reviewed = (version = 3): RolloverReview => ({
  year: 2027, sourceYear: 2026, version, yearVersion: 2, sourceVersion: 1,
  missing: [], issues: [], canActivate: true,
  warnings: { studentsWithSameGrade: 1, futureMealDatesOfLeavers: 0, remainingMealDatesInSourceYear: 2 },
  summary: { members: 2, newAccounts: 0, linkedAccounts: 0, changedStudents: 0,
    changedTeachers: 0, leavers: 0, removedDraftCandidates: 0 },
});
function setup(isMain = true) {
  const onChanged = vi.fn();
  const onActivated = vi.fn();
  return { controller: createRolloverController({ year: 2027, isMain, onChanged, onActivated }), onChanged, onActivated };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function acknowledge(controller: ReturnType<typeof createRolloverController>) {
  controller.acknowledge("uploads", true);
  controller.acknowledge("paused", true);
  controller.acknowledge("warnings", true);
}
beforeEach(() => {
  vi.resetAllMocks();
  request.mockResolvedValue({ ok: true, data: { review: reviewed() } });
});

describe("전환 검토와 재전송", () => {
  it("전체 검토 응답 뒤에만 확인 화면을 열고 MAIN/키오스크/경고 확인을 요구한다", async () => {
    const { controller } = setup();
    await controller.load();
    expect(controller.getSnapshot().review?.version).toBe(3);
    await controller.activate();
    expect(mutate).not.toHaveBeenCalled();
    controller.acknowledge("uploads", true);
    controller.acknowledge("paused", true);
    await controller.activate();
    expect(mutate).not.toHaveBeenCalled();
    const writer = setup(false).controller;
    await writer.load();
    acknowledge(writer);
    await writer.activate();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("응답 유실 재시도는 원래 버전·확인·requestId를 유지하고 중복 클릭을 막는다", async () => {
    const pending = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    mutate.mockReturnValueOnce(pending.promise);
    const { controller, onActivated } = setup();
    await controller.load();
    acknowledge(controller);
    const first = controller.activate();
    await controller.activate();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0].slice(0, 2)).toEqual(["/api/admin/academic-years/2027/activate", "POST"]);
    const original = mutate.mock.calls[0][2] as { requestId: string };
    expect(original).toMatchObject({ expectedVersion: 3, yearVersion: 2, sourceVersion: 1,
      kiosksPaused: true, warningsAcknowledged: true });
    pending.resolve({ ok: false, status: 0, code: null, message: "응답 유실", conflict: false });
    await first;
    expect(onActivated).not.toHaveBeenCalled();
    controller.acknowledge("uploads", false);
    await controller.load();
    expect(request).toHaveBeenCalledTimes(1);
    mutate.mockResolvedValueOnce({ ok: true, data: { receipt: { requestId: original.requestId, version: 4, changed: 2 } } });
    await controller.retry();
    expect(mutate.mock.calls[1][2]).toEqual(original);
    expect(controller.getSnapshot().stage).toBe("DONE");
    expect(onActivated).toHaveBeenCalledWith(2027);
  });

  it("409 뒤 강제 재검토하며 모든 확인과 이전 요청을 버린다", async () => {
    const { controller } = setup();
    await controller.load();
    acknowledge(controller);
    request.mockResolvedValueOnce({ ok: true, data: { review: reviewed(8) } });
    mutate.mockResolvedValueOnce({ ok: false, status: 409, code: "VERSION_CONFLICT", message: "변경됨", conflict: true });
    await controller.activate();
    expect(controller.getSnapshot()).toMatchObject({ stage: "READY", review: { version: 8 },
      acknowledgements: { uploads: false, paused: false, warnings: false }, pending: false });
    await controller.activate();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("닫힌 검토의 늦은 응답은 새 검토나 성공 후 연도 선택을 바꾸지 않는다", async () => {
    const response = deferred<MutationResult<{ review: RolloverReview }>>();
    request.mockReturnValueOnce(response.promise);
    const { controller, onActivated } = setup();
    const loading = controller.load();
    controller.dispose();
    response.resolve({ ok: true, data: { review: reviewed() } });
    await loading;
    expect(controller.getSnapshot().review).toBeNull();
    expect(onActivated).not.toHaveBeenCalled();
  });

  it("전환 중 화면이 교체되면 늦은 성공은 캐시만 갱신하고 선택 연도를 바꾸지 않는다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    mutate.mockReturnValueOnce(response.promise);
    const { controller, onChanged, onActivated } = setup();
    await controller.load();
    acknowledge(controller);
    const activating = controller.activate();
    controller.dispose();
    response.resolve({ ok: true, data: { receipt: { requestId: "activated", version: 4, changed: 2 } } });
    await activating;
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onActivated).not.toHaveBeenCalled();
  });

  it("경고가 모두 0이면 경고 확인 없이 두 키오스크 확인만으로 전환한다", async () => {
    request.mockResolvedValueOnce({ ok: true, data: { review: { ...reviewed(),
      warnings: { studentsWithSameGrade: 0, futureMealDatesOfLeavers: 0, remainingMealDatesInSourceYear: 0 } } } });
    mutate.mockResolvedValueOnce({ ok: true, data: { receipt: { requestId: "activated", version: 4, changed: 2 } } });
    const { controller, onActivated } = setup();
    await controller.load();
    controller.acknowledge("uploads", true);
    controller.acknowledge("paused", true);
    await controller.activate();
    expect(mutate.mock.calls[0][2]).toMatchObject({ kiosksPaused: true, warningsAcknowledged: false });
    expect(onActivated).toHaveBeenCalledWith(2027);
  });

  it("StrictMode 재마운트는 이전 검토 응답을 버리고 새 응답을 유지한다", async () => {
    const stale = deferred<MutationResult<{ review: RolloverReview }>>();
    request.mockReturnValueOnce(stale.promise);
    const { controller } = setup();
    const first = controller.load();
    controller.dispose();
    controller.mount();
    request.mockResolvedValueOnce({ ok: true, data: { review: reviewed(8) } });
    await controller.load();
    stale.resolve({ ok: true, data: { review: reviewed(3) } });
    await first;
    expect(controller.getSnapshot()).toMatchObject({ stage: "READY", review: { version: 8 } });
  });

  it("누락 결정은 본래 역할과 복원 가능 여부를 검사하고 성공 뒤 새 검토를 받는다", async () => {
    const missing = { userId: 7, role: "TEACHER" as const, suggested: null, decision: null, canRestore: false,
      profile: { role: "TEACHER" as const, name: "교사", grade: null, classNum: null, number: null,
        gender: null, subject: "수학", homeroom: null, position: null } };
    request.mockResolvedValueOnce({ ok: true, data: { review: { ...reviewed(), missing: [missing], canActivate: false } } });
    const { controller } = setup(false);
    await controller.load();
    await controller.decide(7, "GRADUATED");
    await controller.decide(7, "RESTORE");
    expect(mutate).not.toHaveBeenCalled();
    mutate.mockImplementationOnce(async (_url, _method, body) => ({ ok: true,
      data: { receipt: { requestId: (body as { requestId: string }).requestId, version: 4, changed: 1 } } }));
    await controller.decide(7, "RETIRED");
    expect(mutate.mock.calls[0].slice(0, 2)).toEqual(["/api/admin/academic-years/2027/decisions", "PUT"]);
    expect(mutate.mock.calls[0][2]).toMatchObject({ expectedVersion: 3, userId: 7, decision: "RETIRED" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().acknowledgements).toEqual({ uploads: false, paused: false, warnings: false });
  });
});
