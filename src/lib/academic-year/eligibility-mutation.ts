import type { PrismaClient } from "@/generated/prisma/client";
import { assertActor } from "./access";
import type { Actor } from "./contracts";
import type { Tx } from "./db";
import { USER_TX } from "./mutation";
import { rosterMode } from "./registration-context";

export type EligibilityScope = "APPLICATION" | "REGISTRATION";

export type EligibilityChange<T> = {
  scope: EligibilityScope;
  applicationId?: number;
  userId?: number;
  /** 신규 공고처럼 write가 끝나야 id가 정해지는 경우. */
  applicationIdOf?: (result: T) => number;
  /** 자격 입력이 실제로 바뀐 경우만 증거를 남기고 싶을 때. 기본은 항상 기록. */
  recorded?: (result: T) => boolean;
};

/**
 * 공고·신청 쓰기의 공통 껍데기. 명부 control 행은 잠그지 않는다 — 신청은 명부
 * 작업과 다른 자원이고, 공고 개시 직후 몰리는 신청이 명부 전역 잠금 뒤에 줄
 * 서면 안 된다. 직렬화가 필요한 범위는 그 공고 한 행뿐이다.
 */
export async function withEligibilityMutation<T>(
  db: PrismaClient,
  actor: Actor,
  change: EligibilityChange<T>,
  write: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    if (change.applicationId !== undefined) {
      await tx.$queryRaw`SELECT id FROM "MealApplication" WHERE id = ${change.applicationId} FOR UPDATE`;
    }

    // 잠금 없이 읽는다. PREPARING에서도 기존 신청 흐름은 그대로 동작해야 한다.
    await rosterMode(tx);
    await assertActor(tx, actor, "SIGNED_IN");

    const result = await write(tx);

    if (change.recorded?.(result) ?? true) {
      await tx.eligibilityEvent.create({
        data: {
          scope: change.scope,
          applicationId: change.applicationId ?? change.applicationIdOf?.(result) ?? null,
          userId: change.userId ?? null,
          occurredAt: new Date(),
        },
      });
    }

    return result;
  }, USER_TX);
}
