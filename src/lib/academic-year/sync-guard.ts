import { NextResponse } from "next/server";
import { domainErrorStatus } from "./api";
import { isDomainError } from "./errors";

/**
 * 키오스크 동기화 두 경로의 오류 변환. `api.ts`의 `{error:{code,message}}` 대신
 * 기존 `{error: "..."}` 모양을 유지한다 — 배포된 태블릿은 상태코드와 이 모양만
 * 읽고, 응답 본문 모양이 바뀌면 오프라인 기기가 조용히 실패한다.
 */
export async function syncErrorResponse(
  run: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ error: error.message, errorCode: error.code }, {
        status: domainErrorStatus(error.code),
      });
    }
    console.error("[sync] 처리하지 못한 동기화 오류", error);
    return NextResponse.json({ error: "요청을 처리하지 못했습니다." }, { status: 500 });
  }
}
