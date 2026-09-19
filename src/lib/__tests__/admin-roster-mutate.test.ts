import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFLICT_HINT, requestJson, sendMutation } from "@/lib/admin-roster/mutate";

const mocks = vi.hoisted(() => ({ fetchWithSessionRecovery: vi.fn() }));

vi.mock("@/lib/session-recovery", () => ({
  fetchWithSessionRecovery: mocks.fetchWithSessionRecovery,
}));

const URL = "/api/admin/academic-years/2026/roster";
const FALLBACK = "명부를 저장하지 못했습니다.";

function respond(body: unknown, status: number): void {
  mocks.fetchWithSessionRecovery.mockResolvedValue(Response.json(body, { status }));
}

describe("명부 변경 요청", () => {
  beforeEach(() => {
    mocks.fetchWithSessionRecovery.mockReset();
  });

  it("코드가 없어도 409는 덮어쓰기 대신 충돌 안내를 반환한다", async () => {
    respond({ error: "다른 요청과 충돌했습니다." }, 409);

    await expect(requestJson(URL, { method: "PATCH" }, FALLBACK)).resolves.toEqual({
      ok: false,
      status: 409,
      code: null,
      message: CONFLICT_HINT,
      conflict: true,
    });
    expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledTimes(1);
  });

  it.each(["VERSION_CONFLICT", "IDENTITY_CONFLICT", "REQUEST_REUSED"])(
    "%s 코드는 HTTP 상태와 별도로 충돌로 처리하고 자동 재시도하지 않는다",
    async (code) => {
      respond({ error: { code, message: "서버 충돌 상세" } }, 400);

      await expect(requestJson(URL, { method: "PATCH" }, FALLBACK)).resolves.toEqual({
        ok: false,
        status: 400,
        code,
        message: CONFLICT_HINT,
        conflict: true,
      });
      expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { body: { error: "이메일을 확인하세요." }, code: null, message: "이메일을 확인하세요." },
    {
      body: { error: { code: "INVALID_FILE", message: "학생 시트가 필요합니다." } },
      code: "INVALID_FILE",
      message: "학생 시트가 필요합니다.",
    },
    { body: { error: { code: "FORBIDDEN", message: "" } }, code: "FORBIDDEN", message: FALLBACK },
    { body: { error: { code: 123, message: { reason: "숨겨진 객체" } } }, code: null, message: FALLBACK },
  ])("비충돌 오류에서 사람이 읽을 메시지만 사용한다: $message", async ({ body, code, message }) => {
    respond(body, 400);

    await expect(requestJson(URL, { method: "POST" }, FALLBACK)).resolves.toEqual({
      ok: false,
      status: 400,
      code,
      message,
      conflict: false,
    });
  });

  it("JSON이 아닌 서버 오류는 기본 안내로 처리하고 자동 재시도하지 않는다", async () => {
    mocks.fetchWithSessionRecovery.mockResolvedValue(new Response("upstream unavailable", { status: 503 }));

    await expect(requestJson(URL, { method: "PATCH" }, FALLBACK)).resolves.toEqual({
      ok: false,
      status: 503,
      code: null,
      message: FALLBACK,
      conflict: false,
    });
    expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledTimes(1);
  });

  it("응답 유실은 네트워크 오류로 반환하고 변경을 자동 재전송하지 않는다", async () => {
    mocks.fetchWithSessionRecovery.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(sendMutation(URL, "PATCH", { requestId: "same-request" }, FALLBACK)).resolves.toEqual({
      ok: false,
      status: 0,
      code: null,
      message: "네트워크 오류입니다. 연결을 확인하고 다시 시도하세요.",
      conflict: false,
    });
    expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledTimes(1);
  });

  it("조회 응답의 데이터와 버전을 그대로 전달한다", async () => {
    const body = { data: [{ id: "entry-1", name: "학생" }], version: 7 };
    respond(body, 200);
    const init = { method: "GET", cache: "no-store" } as const;

    await expect(requestJson(URL, init, FALLBACK)).resolves.toEqual({ ok: true, data: body });
    expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledExactlyOnceWith(URL, init);
  });

  it("변경 요청의 requestId와 영수증을 바꾸지 않는다", async () => {
    const body = { requestId: "same-request", expectedVersion: 7, name: "학생변경" };
    const receipt = { requestId: body.requestId, version: 8, changed: 1 };
    respond({ receipt }, 200);

    await expect(sendMutation(URL, "PATCH", body, FALLBACK)).resolves.toEqual({
      ok: true,
      data: { receipt },
    });
    expect(mocks.fetchWithSessionRecovery).toHaveBeenCalledExactlyOnceWith(URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });
});
