import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportPreview, MutationReceipt } from "@/lib/academic-year/contracts";
import { createImportController } from "@/lib/admin-roster/import-controller";
import { requestJson, sendMutation, type MutationResult } from "@/lib/admin-roster/mutate";

vi.mock("@/lib/admin-roster/mutate", () => ({ requestJson: vi.fn(), sendMutation: vi.fn() }));

const request = vi.mocked(requestJson);
const mutate = vi.mocked(sendMutation);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function preview(id = "import-a", year = 2027): ImportPreview {
  return { id, year, scope: "PARTIAL", controlVersion: 2, yearVersion: 1,
    rows: [], missingUserIds: [], coveredRoles: ["STUDENT"], canCommit: true };
}

function setup(year = 2027) {
  const onCommitted = vi.fn();
  const onError = vi.fn();
  const controller = createImportController({ year, scope: "PARTIAL", onCommitted, onError });
  return { controller, onCommitted, onError };
}

const file = () => new File(["test"], "roster.xlsx");
const success = (value: ImportPreview) => ({ ok: true as const, data: { preview: value } });
const deletes = () => request.mock.calls.filter(([, init]) => init.method === "DELETE");

beforeEach(() => {
  vi.resetAllMocks();
  request.mockResolvedValue({ ok: true, data: { cancelled: true } });
});

describe("Excel 가져오기 비동기 경합", () => {
  it("파일 교체 뒤 늦게 도착한 POST는 표시하지 않고 생성된 서버 사본을 지운다", async () => {
    const first = deferred<MutationResult<{ preview: ImportPreview }>>();
    request.mockReturnValueOnce(first.promise).mockResolvedValueOnce(success(preview("import-b")));
    const { controller } = setup();
    const firstRun = controller.validate(file());
    await controller.reset();
    await controller.validate(file());
    first.resolve(success(preview()));
    await firstRun;
    expect(controller.getSnapshot().preview?.id).toBe("import-b");
    expect(deletes().map(([url]) => url)).toEqual(["/api/admin/academic-years/2027/imports/import-a"]);
  });

  it.each(["파일/범위 초기화", "닫기/연도 변경/unmount"])("%s 때 기존 사본을 한 번 삭제한다", async (kind) => {
    request.mockResolvedValueOnce(success(preview()));
    const { controller } = setup();
    await controller.validate(file());
    await (kind === "파일/범위 초기화" ? controller.reset() : controller.dispose());
    await controller.dispose();
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0][0]).toContain("/2027/imports/import-a");
    expect(controller.getSnapshot().ui.stage).toBe("SELECT");
  });

  it("연도 변경으로 unmount한 뒤 생성된 사본은 원래 연도에서 삭제한다", async () => {
    const response = deferred<MutationResult<{ preview: ImportPreview }>>();
    request.mockReturnValueOnce(response.promise);
    const old = setup(2027).controller;
    const pending = old.validate(file());
    await old.dispose();
    const current = setup(2028).controller;
    response.resolve(success(preview()));
    await pending;
    expect(current.getSnapshot().ui.stage).toBe("SELECT");
    expect(deletes()[0][0]).toBe("/api/admin/academic-years/2027/imports/import-a");
  });

  it("선택 PATCH가 끝난 뒤 삭제하여 취소한 미리보기 내용이 다시 저장되지 않는다", async () => {
    const response = deferred<MutationResult<{ preview: ImportPreview }>>();
    request.mockResolvedValueOnce(success(preview())).mockReturnValueOnce(response.promise);
    const { controller } = setup();
    await controller.validate(file());
    const resolving = controller.resolve("row-a", "USE_FILE");
    const cleanup = controller.reset();
    expect(deletes()).toHaveLength(0);
    response.resolve(success(preview()));
    await Promise.all([resolving, cleanup]);
    expect(deletes()).toHaveLength(1);
    expect(controller.getSnapshot().ui.stage).toBe("SELECT");
  });

  it("PATCH를 직렬화하고 선택 저장 중 확정은 보내지 않는다", async () => {
    const response = deferred<MutationResult<{ preview: ImportPreview }>>();
    request.mockResolvedValueOnce(success(preview())).mockReturnValueOnce(response.promise);
    const { controller } = setup();
    await controller.validate(file());
    const resolving = controller.resolve("row-a", "USE_FILE");
    await controller.resolve("row-b", "KEEP_SERVER");
    await controller.commit();
    expect(request.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(1);
    expect(mutate).not.toHaveBeenCalled();
    response.resolve(success(preview()));
    await resolving;
    expect(controller.getSnapshot().resolving).toBe(false);
  });

  it("잘못된 연도 응답은 확정 가능한 미리보기로 표시하지 않는다", async () => {
    request.mockResolvedValueOnce(success(preview("wrong-year", 2028)));
    const { controller } = setup();
    await controller.validate(file());
    expect(controller.getSnapshot().ui.stage).toBe("SELECT");
    expect(controller.getSnapshot().error).toBeTruthy();
    expect(deletes()[0][0]).toContain("/2028/imports/wrong-year");
  });

  it("빠른 중복 확정을 한 번만 보내며 실패 후 같은 요청키로 재시도한다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    request.mockResolvedValueOnce(success(preview()));
    mutate.mockReturnValueOnce(response.promise);
    const { controller, onCommitted } = setup();
    await controller.validate(file());
    const committing = controller.commit();
    await controller.commit();
    expect(mutate).toHaveBeenCalledTimes(1);
    const firstBody = mutate.mock.calls[0][2] as { requestId: string };
    response.resolve({ ok: false, status: 0, code: null, message: "연결 끊김", conflict: false });
    await committing;
    mutate.mockResolvedValueOnce({ ok: true, data: { receipt: {
      requestId: firstBody.requestId, changed: 1, version: 3,
    } } });
    await controller.commit();
    expect(mutate.mock.calls[1][2]).toEqual(mutate.mock.calls[0][2]);
    expect(onCommitted).toHaveBeenCalledTimes(1);
    await controller.reset();
    await controller.dispose();
    expect(deletes()).toHaveLength(0);
  });

  it("확정 중 닫혀도 성공 응답의 사본은 삭제하지 않는다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    request.mockResolvedValueOnce(success(preview()));
    mutate.mockReturnValueOnce(response.promise);
    const { controller } = setup();
    await controller.validate(file());
    const committing = controller.commit();
    const cleanup = controller.dispose();
    expect(deletes()).toHaveLength(0);
    const { requestId } = mutate.mock.calls[0][2] as { requestId: string };
    response.resolve({ ok: true, data: { receipt: { requestId, changed: 1, version: 3 } } });
    await Promise.all([committing, cleanup]);
    expect(deletes()).toHaveLength(0);
    expect(controller.getSnapshot().ui.stage).toBe("SELECT");
  });

  it("취소된 PATCH 실패는 새 미리보기나 오류 메시지를 덮지 않는다", async () => {
    const response = deferred<MutationResult<{ preview: ImportPreview }>>();
    request.mockResolvedValueOnce(success(preview())).mockReturnValueOnce(response.promise);
    const { controller, onError } = setup();
    await controller.validate(file());
    const resolving = controller.resolve("row-a", "USE_FILE");
    const cleanup = controller.reset();
    request.mockResolvedValueOnce(success(preview("import-b")));
    await controller.validate(file());
    response.resolve({ ok: false, status: 409, code: "VERSION_CONFLICT", message: "old", conflict: true });
    await Promise.all([resolving, cleanup]);
    expect(controller.getSnapshot().preview?.id).toBe("import-b");
    expect(controller.getSnapshot().error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("다른 ID의 PATCH 응답을 거부하고 선택 저장 잠금을 해제한다", async () => {
    request.mockResolvedValueOnce(success(preview())).mockResolvedValueOnce(success(preview("import-other")));
    const { controller } = setup();
    await controller.validate(file());
    await controller.resolve("row-a", "USE_FILE");
    expect(controller.getSnapshot().preview?.id).toBe("import-a");
    expect(controller.getSnapshot().resolving).toBe(false);
    expect(controller.getSnapshot().error).toBeTruthy();
  });

  it("PATCH 응답을 잃으면 실제 서버 선택을 다시 확인하기 전에는 반영하지 않는다", async () => {
    mutate.mockResolvedValueOnce({ ok: false, status: 0, code: null, message: "unexpected commit", conflict: false });
    request.mockResolvedValueOnce(success(preview())).mockResolvedValueOnce({
      ok: false, status: 0, code: null, message: "연결 끊김", conflict: false,
    });
    const { controller } = setup();
    await controller.validate(file());
    await controller.resolve("row-a", "KEEP_SERVER");
    await controller.commit();
    expect(mutate).not.toHaveBeenCalled();
    expect(controller.getSnapshot().preview?.canCommit).toBe(false);
    request.mockResolvedValueOnce(success(preview()));
    await controller.resolve("row-a", "KEEP_SERVER");
    expect(controller.getSnapshot().preview?.canCommit).toBe(true);
  });

  it("반영이 실패한 뒤 닫힌 사본은 삭제하고 새 화면 상태는 유지한다", async () => {
    const response = deferred<MutationResult<{ receipt: MutationReceipt }>>();
    request.mockResolvedValueOnce(success(preview()));
    mutate.mockReturnValueOnce(response.promise);
    const { controller, onError, onCommitted } = setup();
    await controller.validate(file());
    const committing = controller.commit();
    const cleanup = controller.dispose();
    response.resolve({ ok: false, status: 409, code: "VERSION_CONFLICT", message: "old", conflict: true });
    await Promise.all([committing, cleanup]);
    expect(deletes()).toHaveLength(1);
    expect(controller.getSnapshot().ui.stage).toBe("SELECT");
    expect(onError).not.toHaveBeenCalled();
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("Strict Mode 재설정 뒤 이전 요청은 새 화면을 덮지 않는다", async () => {
    const response = deferred<MutationResult<{ preview: ImportPreview }>>();
    request.mockReturnValueOnce(response.promise);
    const { controller } = setup();
    const pending = controller.validate(file());
    await controller.dispose();
    controller.activate();
    response.resolve(success(preview()));
    await pending;
    expect(controller.getSnapshot().ui.stage).toBe("SELECT");
    expect(deletes()).toHaveLength(1);
  });
});
