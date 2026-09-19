import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkInReviewPayload, type CheckInReviewRow } from "@/lib/admin-roster/checkin-review";
import { createCheckInReviewController } from "@/lib/admin-roster/checkin-review-controller";
import { requestJson, sendMutation, type MutationResult } from "@/lib/admin-roster/mutate";
import type { MutationReceipt } from "@/lib/academic-year/contracts";

vi.mock("@/lib/admin-roster/mutate", () => ({ requestJson: vi.fn(), sendMutation: vi.fn() }));
const read = vi.mocked(requestJson);
const write = vi.mocked(sendMutation);
const payload = { userId: 9, date: "2026-02-28", checkedAt: "2026-02-28T09:30:42.000Z", type: "STUDENT" };
const review = (state: CheckInReviewRow["state"] = "PENDING", mealKind?: string): CheckInReviewRow => ({
  id: "review-9", clientKey: "device:9", snapshotId: null, state, reason: "식사 구분이 없습니다.",
  payload: { ...payload, ...(mealKind ? { mealKind } : {}) }, decision: null,
  createdAt: "2026-09-19T04:00:00.000Z", resolvedAt: null, subject: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(canWrite = true) {
  const onChanged = vi.fn();
  const onPendingChange = vi.fn();
  return { controller: createCheckInReviewController({ reviewId: "review-9", canWrite, onChanged, onPendingChange }), onChanged, onPendingChange };
}
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue({ ok: true, data: { reviews: [review()] } });
  write.mockResolvedValue({ ok: true, data: { receipt: { requestId: "receipt", version: 0, changed: 1 } } });
});

describe("체크인 원본 해석", () => {
  it("접수일과 무관한 원본 발생시각·식사일의 학년도를 유지하고 식사를 추정하지 않는다", () => {
    expect(checkInReviewPayload(payload)).toMatchObject({ userId: 9, year: 2025, date: "2026-02-28",
      checkedAt: "2026-02-28T09:30:42.000Z", mealKind: null, invalidMealKind: false, canAccept: true });
  });
  it("없는 payload와 잘못된 날짜는 승인할 수 없고 잘못된 식사를 결측으로 취급하지 않는다", () => {
    expect(checkInReviewPayload(null).canAccept).toBe(false);
    expect(checkInReviewPayload({ ...payload, date: "2026-02-30" }).canAccept).toBe(false);
    expect(checkInReviewPayload({ ...payload, mealKind: "UNKNOWN" })).toMatchObject({ invalidMealKind: true, canAccept: false });
  });
});

describe("체크인 검토 결정", () => {
  it("사유와 레거시 식사를 모두 명시하기 전에는 승인 요청을 보내지 않는다", async () => {
    const { controller } = setup();
    await controller.load();
    expect(controller.getSnapshot().review?.id).toBe("review-9");
    await controller.submit();
    expect(controller.getSnapshot().error).toContain("사유");
    controller.setReason("담임과 원본 기록 확인");
    await controller.submit();
    expect(controller.getSnapshot().error).toContain("식사");
    expect(write).not.toHaveBeenCalled();
  });
  it("읽기 권한은 입력과 승인·거절을 실행할 수 없다", async () => {
    const { controller } = setup(false);
    await controller.load();
    expect(controller.getSnapshot().review?.id).toBe("review-9");
    controller.setReason("거절 사유"); controller.setDecision("REJECT");
    await controller.submit();
    expect(controller.getSnapshot().reason).toBe("");
    expect(write).not.toHaveBeenCalled();
  });
  it("중복 클릭과 응답 유실 후 변경을 막고 원래 requestId와 payload로 재시도한다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    write.mockReturnValueOnce(response.promise);
    const { controller, onPendingChange } = setup();
    await controller.load();
    controller.setReason(" 확인 완료 "); controller.setMealKind("LUNCH");
    const first = controller.submit(); await controller.submit();
    expect(write).toHaveBeenCalledTimes(1);
    const original = write.mock.calls[0][2];
    expect(original).toEqual({ requestId: expect.any(String), decision: "ACCEPT", reason: "확인 완료", mealKind: "LUNCH" });
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    response.resolve({ ok: false, status: 0, code: null, conflict: false, message: "응답 유실" });
    await first;
    controller.setDecision("REJECT"); controller.setReason("다른 판단"); controller.setMealKind("DINNER");
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ pending: true, decision: "ACCEPT", reason: " 확인 완료 ", mealKind: "LUNCH" });
    read.mockResolvedValueOnce({ ok: true, data: { reviews: [review("DUPLICATE")] } });
    await controller.retry();
    expect(write.mock.calls[1][2]).toEqual(original);
    expect(controller.getSnapshot()).toMatchObject({ pending: false, review: { state: "DUPLICATE" } });
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });
  it("409는 최신 행을 재조회하고 기존 사유·결정을 지워 자동 덮어쓰기를 막는다", async () => {
    const { controller, onChanged } = setup();
    await controller.load(); controller.setReason("확인"); controller.setDecision("REJECT");
    write.mockResolvedValueOnce({ ok: false, status: 409, code: "VERSION_CONFLICT", conflict: true, message: "이미 처리됨" });
    read.mockResolvedValueOnce({ ok: true, data: { reviews: [review("ACCEPTED")] } });
    await controller.submit();
    expect(controller.getSnapshot()).toMatchObject({ pending: false, reason: "", review: { state: "ACCEPTED" } });
    await controller.submit();
    expect(write).toHaveBeenCalledTimes(1); expect(onChanged).toHaveBeenCalledOnce();
  });
  it("거절은 원본 식사가 없어도 가능하고 원본이 잘못된 경우도 식사를 추정하지 않는다", async () => {
    read.mockResolvedValueOnce({ ok: true, data: { reviews: [{ ...review(), payload: null }] } });
    const { controller } = setup();
    await controller.load(); controller.setReason("원본을 확인할 수 없음"); controller.setDecision("REJECT");
    await controller.submit();
    expect(write.mock.calls[0][2]).toEqual({ requestId: expect.any(String), decision: "REJECT", reason: "원본을 확인할 수 없음" });
  });
  it("잘못된 비null 식사 구분을 새 선택으로 덮어 승인하지 않는다", async () => {
    read.mockResolvedValueOnce({ ok: true, data: { reviews: [review("PENDING", "UNKNOWN")] } });
    const { controller } = setup();
    await controller.load(); controller.setReason("확인"); controller.setMealKind("LUNCH");
    await controller.submit();
    expect(write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toContain("원본");
  });
  it("서버 500도 미확정 요청으로 보존하며 성공 뒤 조회 실패를 승인 결과로 추정하지 않는다", async () => {
    const { controller } = setup();
    await controller.load(); controller.setDecision("REJECT"); controller.setReason("기록 확인 불가");
    write.mockResolvedValueOnce({ ok: false, status: 500, code: null, conflict: false, message: "서버 오류" });
    await controller.submit();
    expect(controller.getSnapshot().pending).toBe(true);
    const original = write.mock.calls[0][2];
    read.mockResolvedValueOnce({ ok: false, status: 503, code: null, conflict: false, message: "조회 실패" });
    await controller.retry();
    expect(write.mock.calls[1][2]).toEqual(original);
    expect(controller.getSnapshot()).toMatchObject({ stage: "IDLE", review: null, pending: false, error: "조회 실패" });
    await controller.submit();
    expect(write).toHaveBeenCalledTimes(2);
    read.mockResolvedValueOnce({ ok: true, data: { reviews: [review("REJECTED")] } });
    await controller.load();
    expect(controller.getSnapshot().review?.state).toBe("REJECTED");
  });
  it("400 수정 후 새 요청을 만들고 식사가 있는 원본에는 보완값을 보내지 않는다", async () => {
    read.mockResolvedValueOnce({ ok: true, data: { reviews: [review("PENDING", "DINNER")] } });
    const { controller } = setup();
    await controller.load(); controller.setReason("첫 판단");
    write.mockResolvedValueOnce({ ok: false, status: 400, code: "INVALID_INPUT", conflict: false, message: "보완 필요" });
    await controller.submit();
    const first = write.mock.calls[0][2] as { requestId: string };
    controller.setReason("추가 확인 후 판단"); await controller.submit();
    expect(write.mock.calls[1][2]).toEqual({ requestId: expect.not.stringContaining(first.requestId), decision: "ACCEPT", reason: "추가 확인 후 판단" });
  });
  it("이전 상세의 늦은 응답과 다른 id의 응답은 새 선택에 반영하지 않는다", async () => {
    const response = deferred<MutationResult<{ reviews: CheckInReviewRow[] }>>();
    read.mockReturnValueOnce(response.promise);
    const { controller } = setup();
    const loading = controller.load(); controller.dispose(); controller.mount();
    read.mockResolvedValueOnce({ ok: true, data: { reviews: [{ ...review(), id: "other" }] } });
    await controller.load();
    response.resolve({ ok: true, data: { reviews: [review()] } }); await loading;
    expect(controller.getSnapshot().review).toBeNull();
    expect(controller.getSnapshot().error).not.toBeNull();
  });
  it("상세를 떠난 후 늦게 완료된 결정은 캐시만 갱신한다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    write.mockReturnValueOnce(response.promise);
    const { controller, onChanged } = setup();
    await controller.load(); controller.setDecision("REJECT"); controller.setReason("확인 불가");
    const saving = controller.submit(); controller.dispose();
    response.resolve({ ok: true, data: { receipt: { requestId: "late", version: 0, changed: 1 } } });
    await saving;
    expect(onChanged).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
