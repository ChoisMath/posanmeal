import type { Actor } from "./contracts";
import type { Db } from "./db";
import { DomainError } from "./errors";

export type AccessRequirement =
  | "SIGNED_IN"
  | "STUDENT"
  | "TEACHER"
  | "READ_ADMIN"
  | "WRITE_ADMIN"
  | "MAIN";

/** 별도 관리자 로그인은 DB 행이 없으므로 명부 역할이 필요한 요구는 통과시키지 않는다. */
const MAIN_ALLOWED: ReadonlySet<AccessRequirement> = new Set<AccessRequirement>([
  "SIGNED_IN",
  "READ_ADMIN",
  "WRITE_ADMIN",
  "MAIN",
]);

/**
 * 모든 보호 경로의 최종 근거. 토큰이 아니라 지금의 DB 행을 읽어 이용 상태·세션
 * 세대·역할·관리자 등급을 다시 판정한다. `auth`를 import하지 않으므로 트랜잭션
 * 안에서도 그대로 쓸 수 있다.
 */
export async function assertActor(
  tx: Db,
  actor: Actor,
  required: AccessRequirement,
): Promise<void> {
  if (actor.kind === "MAIN") {
    if (!MAIN_ALLOWED.has(required)) {
      throw new DomainError("FORBIDDEN", "이 기능은 학생·교사 계정만 사용할 수 있습니다.");
    }
    return;
  }

  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { role: true, adminLevel: true, accessState: true, sessionVersion: true },
  });

  if (!user || user.accessState !== "ACTIVE") {
    throw new DomainError("ACCOUNT_INACTIVE", "이용이 중지된 계정입니다. 관리자에게 문의하세요.");
  }
  if (user.sessionVersion !== actor.sessionVersion) {
    throw new DomainError("STALE_SESSION", "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.");
  }

  if (required === "MAIN") {
    throw new DomainError("FORBIDDEN", "메인 관리자만 할 수 있는 작업입니다.");
  }
  if (required === "SIGNED_IN") return;
  if (required === "STUDENT" || required === "TEACHER") {
    if (user.role !== required) {
      throw new DomainError("FORBIDDEN", "권한이 없습니다.");
    }
    return;
  }

  const level = user.adminLevel;
  const allowed =
    required === "WRITE_ADMIN" ? level === "ADMIN" : level === "ADMIN" || level === "SUBADMIN";
  if (!allowed) {
    throw new DomainError("FORBIDDEN", "관리자 권한이 없습니다.");
  }
}
