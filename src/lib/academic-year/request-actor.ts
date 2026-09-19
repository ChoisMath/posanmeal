import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertActor, type AccessRequirement } from "./access";
import type { Actor } from "./contracts";
import type { Db } from "./db";
import { DomainError } from "./errors";

/** 별도 관리자 로그인은 DB 사용자와 겹치지 않는 예약 id로 구분한다. */
const MAIN_ADMIN_DB_ID = 0;

const MAIN_ACTOR: Actor = { kind: "MAIN", userId: null, sessionVersion: null };

/**
 * Route Handler의 첫 단계. 세션에서 신원만 읽고, 허용 여부는 DB 재검증에 맡긴다.
 * `auth()`를 부르는 유일한 자리라 `access.ts`는 순환 import 없이 남는다.
 */
export async function requireActor(
  required: AccessRequirement,
  db: Db = prisma,
): Promise<Actor> {
  const session = await auth();
  const user = session?.user;
  if (!user) {
    throw new DomainError("UNAUTHENTICATED", "로그인이 필요합니다.");
  }

  if (user.role === "ADMIN" && user.dbUserId === MAIN_ADMIN_DB_ID) {
    await assertActor(db, MAIN_ACTOR, required);
    return MAIN_ACTOR;
  }

  // 세션 세대가 없는 토큰은 이 기능 이전에 발급된 것이라 무효화 이력을 담지 못한다.
  if (typeof user.dbUserId !== "number" || typeof user.sessionVersion !== "number") {
    throw new DomainError("STALE_SESSION", "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.");
  }

  const actor: Actor = {
    kind: "USER",
    userId: user.dbUserId,
    sessionVersion: user.sessionVersion,
  };
  await assertActor(db, actor, required);
  return actor;
}

/** 본인 전용 API가 쓰는 좁힘. 별도 관리자 계정에는 본인 행이 없다. */
export function selfUserId(actor: Actor): number {
  if (actor.kind !== "USER") {
    throw new DomainError("FORBIDDEN", "이 기능은 학생·교사 계정만 사용할 수 있습니다.");
  }
  return actor.userId;
}
