import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDraftController } from "@/lib/admin-roster/rollover-draft-controller";
import { requestJson, sendMutation, type MutationResult } from "@/lib/admin-roster/mutate";
import type { MutationReceipt } from "@/lib/academic-year/contracts";

vi.mock("@/lib/admin-roster/mutate", () => ({ requestJson: vi.fn(), sendMutation: vi.fn() }));
const request = vi.mocked(requestJson);
const mutate = vi.mocked(sendMutation);
function setup() {
  const onChanged = vi.fn();
  const onCreated = vi.fn();
  return { controller: createDraftController({ activeYear: 2026, controlVersion: 3, onChanged, onCreated }), onChanged, onCreated };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => vi.resetAllMocks());

describe("학년도 초안 생성", () => {
  it("연속 클릭을 한 번만 전송하고 응답 유실은 원래 버전·requestId로 확인한다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    mutate.mockReturnValueOnce(response.promise);
    const { controller, onCreated } = setup();
    const saving = controller.create();
    await controller.create();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0].slice(0, 2)).toEqual(["/api/admin/academic-years", "POST"]);
    const original = mutate.mock.calls[0][2] as { requestId: string };
    expect(original).toMatchObject({ year: 2027, sourceYear: 2026, expectedVersion: 3 });
    response.resolve({ ok: false, status: 0, code: null, message: "응답 유실", conflict: false });
    await saving;
    expect(onCreated).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pending).toBe(true);
    mutate.mockResolvedValueOnce({ ok: true, data: { receipt: { requestId: original.requestId, version: 4, changed: 2 } } });
    await controller.create();
    expect(mutate.mock.calls[1][2]).toEqual(original);
    expect(onCreated).toHaveBeenCalledWith(2027);
  });

  it("409 뒤 최신 운영 연도·버전을 읽고 다음 확인에 새 요청을 사용한다", async () => {
    const { controller } = setup();
    mutate.mockResolvedValueOnce({ ok: false, status: 409, code: "VERSION_CONFLICT", message: "다른 변경", conflict: true });
    request.mockResolvedValueOnce({ ok: true, data: { controlVersion: 8, years: [{ year: 2026, state: "ACTIVE" }] } });
    await controller.create();
    expect(request).toHaveBeenCalledWith("/api/admin/academic-years", {}, expect.any(String));
    expect(controller.getSnapshot()).toMatchObject({ stage: "READY", controlVersion: 8, pending: false });
    mutate.mockResolvedValueOnce({ ok: false, status: 0, code: null, message: "응답 유실", conflict: false });
    await controller.create();
    const first = mutate.mock.calls[0][2] as { requestId: string };
    const next = mutate.mock.calls[1][2] as { requestId: string };
    expect(next).toMatchObject({ expectedVersion: 8 });
    expect(next.requestId).not.toBe(first.requestId);
  });

  it("409 재조회에서 초안이 이미 있으면 중복 생성하지 않는다", async () => {
    const { controller } = setup();
    mutate.mockResolvedValueOnce({ ok: false, status: 409, code: "VERSION_CONFLICT", message: "다른 변경", conflict: true });
    request.mockResolvedValueOnce({ ok: true, data: { controlVersion: 8, years: [{ year: 2026, state: "ACTIVE" }, { year: 2027, state: "DRAFT" }] } });
    await controller.create();
    expect(controller.getSnapshot().stage).toBe("BLOCKED");
    await controller.create();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("닫힌 다이얼로그의 늦은 성공은 목록만 갱신하고 선택 연도를 변경하지 않는다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    mutate.mockReturnValueOnce(response.promise);
    const { controller, onChanged, onCreated } = setup();
    const saving = controller.create();
    controller.dispose();
    response.resolve({ ok: true, data: { receipt: { requestId: "created", version: 4, changed: 2 } } });
    await saving;
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
