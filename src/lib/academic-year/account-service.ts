import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { invalidateFaceCache } from "@/lib/face-embedding-cache";
import { assertActor } from "./access";
import type { Actor, MutationReceipt, RowMutationInput } from "./contracts";
import type { Tx } from "./db";
import { DomainError } from "./errors";
import { normalizeEmail } from "./profile-schema";
import { withUserMutation } from "./mutation";

const ACCOUNT_SCOPE = "ACCOUNT";

export type AdminLevelInput = "NONE" | "SUBADMIN" | "ADMIN";

export type ChangeEmailInput = RowMutationInput & { email: string };
export type ChangeAccessInput = RowMutationInput & {
  state: "ACTIVE" | "INACTIVE";
  reason: string;
  confirmPrivileges: boolean;
};
export type ChangePermissionsInput = RowMutationInput & { level: AdminLevelInput };

/**
 * 트랜잭션 전용. 학년도 전환이 수백 명을 한 트랜잭션에서 중단시키므로 사용자마다
 * 쿼리를 돌지 않고 집합 연산만 쓴다. 얼굴 캐시 무효화는 커밋 뒤 호출자 몫이다.
 */
export async function deactivateUsers(
  tx: Tx,
  userIds: number[],
  reason: string,
  at: Date,
  requestId?: string,
): Promise<void> {
  if (userIds.length === 0) return;

  await tx.user.updateMany({
    where: { id: { in: userIds } },
    data: { accessState: "INACTIVE", sessionVersion: { increment: 1 } },
  });

  await tx.userAccessEvent.createMany({
    data: userIds.map((userId) => ({
      userId,
      state: "INACTIVE",
      reason,
      effectiveAt: at,
      requestId,
    })),
  });

  await tx.eligibilityEvent.createMany({
    data: userIds.map((userId) => ({ scope: ACCOUNT_SCOPE, userId, occurredAt: at, requestId })),
  });

  await tx.faceProfile.deleteMany({ where: { userId: { in: userIds } } });
}

/**
 * 이메일 교체. 대상 행은 wrapper가 이미 FOR UPDATE로 잡았고, 여기서는 원본 id를
 * 고정한 채 새 키가 남의 것인지만 본다.
 */
export async function changeEmail(
  db: PrismaClient,
  input: ChangeEmailInput,
): Promise<MutationReceipt> {
  const email = input.email.trim();
  const emailKey = normalizeEmail(email);
  if (email.length === 0) {
    throw new DomainError("MISSING_PROFILE", "이메일을 입력하세요.");
  }

  const { receipt } = await withUserMutation(
    db,
    input,
    (tx) => assertActor(tx, input.actor, "WRITE_ADMIN"),
    async (tx) => {
      const taken = await tx.user.findFirst({
        where: {
          id: { not: input.userId },
          OR: [{ emailKey }, { email }],
        },
        select: { id: true },
      });
      if (taken) {
        throw new DomainError("IDENTITY_CONFLICT", "이미 다른 사용자가 쓰는 이메일입니다.");
      }

      await runWithIdentityGuard(() =>
        tx.user.update({
          where: { id: input.userId },
          data: { email, emailKey, sessionVersion: { increment: 1 } },
        }),
      );

      // 연결된 명부 항목의 키도 같은 트랜잭션에서 옮긴다. baseUserVersion은 바뀐
      // profileVersion과 어긋나므로 내보낸 초안·파일은 다음 검토에서 충돌로 잡힌다.
      await runWithIdentityGuard(() =>
        tx.rosterEntry.updateMany({
          where: { userId: input.userId },
          data: { emailKey, version: { increment: 1 } },
        }),
      );

      return { changed: 1, ids: [input.userId] };
    },
  );

  return receipt;
}

/**
 * 자기 자신의 이용 상태·권한을 스스로 바꾸지 못하게 막는다. 관리자가 실수로
 * 자기 계정을 잠그거나 스스로 등급을 올리는 경로를 남기지 않는다. 별도 관리자
 * 로그인(MAIN)에는 대상이 될 행이 없으므로 해당 없다.
 */
function assertNotSelf(actor: Actor, userId: number): void {
  if (actor.kind === "USER" && actor.userId === userId) {
    throw new DomainError("FORBIDDEN", "본인 계정의 이용 상태와 권한은 직접 바꿀 수 없습니다.");
  }
}

/** 이용 중단·재개. 재개는 남아 있던 관리자 권한이 함께 살아나므로 메인 확인을 요구한다. */
export async function changeAccess(
  db: PrismaClient,
  input: ChangeAccessInput,
): Promise<MutationReceipt> {
  const at = new Date();

  const { receipt } = await withUserMutation(
    db,
    input,
    async (tx) => {
      assertNotSelf(input.actor, input.userId);
      if (input.state === "INACTIVE") {
        await assertActor(tx, input.actor, "WRITE_ADMIN");
        return;
      }
      await assertActor(tx, input.actor, "MAIN");
      if (!input.confirmPrivileges) {
        throw new DomainError(
          "FORBIDDEN",
          "재개하면 이전 관리자 권한도 함께 되살아납니다. 확인이 필요합니다.",
        );
      }
    },
    async (tx) => {
      if (input.state === "INACTIVE") {
        await deactivateUsers(tx, [input.userId], input.reason, at, input.requestId);
        return { changed: 1, ids: [input.userId] };
      }

      await tx.user.update({
        where: { id: input.userId },
        data: { accessState: "ACTIVE" },
      });
      await tx.userAccessEvent.create({
        data: {
          userId: input.userId,
          state: "ACTIVE",
          reason: input.reason,
          effectiveAt: at,
          requestId: input.requestId,
        },
      });
      await tx.eligibilityEvent.create({
        data: {
          scope: ACCOUNT_SCOPE,
          userId: input.userId,
          occurredAt: at,
          requestId: input.requestId,
        },
      });

      // 얼굴 등록은 되살리지 않는다. 본인이 다시 동의하고 등록해야 한다.
      return { changed: 1, ids: [input.userId] };
    },
  );

  if (input.state === "INACTIVE") invalidateFaceCache();
  return receipt;
}

/** 관리자 등급 변경. 메인 관리자만 하고, 바뀐 즉시 기존 세션을 끊는다. */
export async function changePermissions(
  db: PrismaClient,
  input: ChangePermissionsInput,
): Promise<MutationReceipt> {
  const { receipt } = await withUserMutation(
    db,
    input,
    async (tx) => {
      assertNotSelf(input.actor, input.userId);
      await assertActor(tx, input.actor, "MAIN");
    },
    async (tx) => {
      const target = await tx.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { role: true },
      });
      if (target.role !== "TEACHER" && input.level !== "NONE") {
        throw new DomainError("FORBIDDEN", "교사 계정에만 관리자 권한을 줄 수 있습니다.");
      }

      await tx.user.update({
        where: { id: input.userId },
        data: { adminLevel: input.level, sessionVersion: { increment: 1 } },
      });

      return { changed: 1, ids: [input.userId] };
    },
  );

  return receipt;
}

/** emailKey·(year, emailKey) unique 위반을 원본 메시지 없이 식별 충돌로 바꾼다. */
async function runWithIdentityGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainError("IDENTITY_CONFLICT", "이미 다른 사용자가 쓰는 이메일입니다.");
    }
    throw error;
  }
}
