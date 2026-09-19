import type { PrismaClient } from "@/generated/prisma/client";
import { assertActor, type AccessRequirement } from "./access";
import type { Actor } from "./contracts";
import type { Tx } from "./db";
import { USER_TX } from "./mutation";
import { assertRosterModeReadable } from "./registration-context";

export type EligibilityScope = "APPLICATION" | "REGISTRATION";

export type EligibilityChange<T> = {
  scope: EligibilityScope;
  applicationId?: number;
  userId?: number;
  /** 트랜잭션 안에서 다시 확인할 권한. 신청 경로는 자격 검사가 따로 확인한다. */
  require?: AccessRequirement;
  /** 대량 경로처럼 기본 15초로는 모자란 쓰기만 따로 늘린다. */
  transaction?: { maxWait: number; timeout: number };
  /** 신규 공고처럼 write가 끝나야 id가 정해지는 경우. */
  applicationIdOf?: (result: T) => number;
  /** 자격 입력이 실제로 바뀐 경우만 증거를 남기고 싶을 때. 기본은 항상 기록. */
  recorded?: (result: T) => boolean;
  /** 한 번에 여러 사람이 바뀌는 경로. 사람마다 한 건씩 남기고, 비면 남기지 않는다. */
  affectedUserIds?: (result: T) => number[];
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

    // 잠금 없이 읽는다. PREPARING에서도 기존 신청 흐름은 그대로 동작해야 하므로
    // READY를 요구하지 않고, 값을 읽을 수 있다는 것만 확인한다.
    await assertRosterModeReadable(tx);

    await assertActor(tx, actor, change.require ?? "SIGNED_IN");

    const result = await write(tx);
    const occurredAt = new Date();
    const applicationId = change.applicationId ?? change.applicationIdOf?.(result) ?? null;

    if (change.affectedUserIds) {
      const userIds = change.affectedUserIds(result);
      if (userIds.length > 0) {
        await tx.eligibilityEvent.createMany({
          data: userIds.map((userId) => ({
            scope: change.scope,
            applicationId,
            userId,
            occurredAt,
          })),
        });
      }
    } else if (change.recorded?.(result) ?? true) {
      await tx.eligibilityEvent.create({
        data: { scope: change.scope, applicationId, userId: change.userId ?? null, occurredAt },
      });
    }

    return result;
  }, change.transaction ?? USER_TX);
}
