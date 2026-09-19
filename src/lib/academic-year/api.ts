import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { DomainErrorCode } from "./contracts";
import { DomainError, isDomainError } from "./errors";

const STATUS: Record<DomainErrorCode, number> = {
  UNAUTHENTICATED: 401,
  STALE_SESSION: 401,
  FORBIDDEN: 403,
  ACCOUNT_INACTIVE: 403,
  VERSION_CONFLICT: 409,
  REQUEST_REUSED: 409,
  IDENTITY_CONFLICT: 409,
  INVALID_FILE: 422,
  YEAR_MISMATCH: 422,
  REVIEW_REQUIRED: 422,
  MISSING_PROFILE: 422,
  INVALID_INPUT: 422,
  NOT_READY: 503,
};

export function domainErrorStatus(code: DomainErrorCode): number {
  return STATUS[code];
}

/**
 * 도메인 오류 → HTTP 변환의 유일한 자리. 예상 밖 오류는 SQL 제약 이름이나 원본
 * 값이 새지 않도록 서버 로그에만 남기고 일반 메시지로 바꾼다.
 */
export function errorResponse(error: unknown): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: STATUS[error.code] },
    );
  }

  console.error("[academic-year] 처리하지 못한 요청 오류", error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

/**
 * 요청이 보낸 해시를 믿지 않는다. 서버가 정규화한 입력만으로 다시 계산해야
 * 같은 요청키로 다른 내용을 밀어 넣는 재전송을 wrapper가 잡아낼 수 있다.
 */
export function payloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseIdParam(raw: string): number {
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new DomainError("MISSING_PROFILE", "대상 사용자를 찾을 수 없습니다.");
  }
  return id;
}

export function parseYearParam(raw: string): number {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return year;
}

export async function routeResponse(
  run: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    return errorResponse(error);
  }
}
