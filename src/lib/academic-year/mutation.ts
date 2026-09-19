import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { MutationInput, MutationReceipt, MutationSummary, RowMutationInput } from "./contracts";
import type { Tx } from "./db";
import { DomainError } from "./errors";

/** 전역 배타 잠금을 잡는 트랜잭션의 공통 옵션. 전환은 이 60초 안에 끝난다. */
export const ROSTER_TX = { maxWait: 10_000, timeout: 60_000 } as const;

/** 셀 편집 한 건이 control 행 공유 잠금을 오래 붙들지 않도록 더 짧게 끊는다. */
export const USER_TX = { maxWait: 10_000, timeout: 15_000 } as const;

type Summary = MutationSummary & Prisma.InputJsonObject;

export type MutationOutcome<T> = { result: T; receipt: MutationReceipt };

interface StoredMutation {
  requestId: string;
  actorUserId: number | null;
  kind: string;
  payloadHash: string;
  result: Prisma.JsonValue;
  version: number;
  changed: number;
}

/**
 * 재전송 판정. 저장된 요청이 같은 actor·kind·payloadHash일 때만 같은 요청으로
 * 인정하고, 그렇지 않으면 다른 입력을 같은 요청키로 밀어 넣는 시도로 본다.
 */
function replayReceipt<T>(
  stored: StoredMutation,
  input: { actorUserId: number | null; kind: string; payloadHash: string },
): MutationOutcome<T> {
  if (
    stored.payloadHash !== input.payloadHash ||
    stored.kind !== input.kind ||
    stored.actorUserId !== input.actorUserId
  ) {
    throw new DomainError("REQUEST_REUSED", "같은 요청키로 다른 내용이 다시 전송되었습니다.");
  }

  return {
    result: stored.result as unknown as T,
    receipt: { requestId: stored.requestId, version: stored.version, changed: stored.changed },
  };
}

/**
 * 전환·Excel 확정·이전 명부 삭제·초안 생성 전용. control 행을 배타 잠금해
 * 전역 변경을 한 줄로 세우고, control version으로 낙관적 충돌을 판정한다.
 */
export async function withAcademicMutation<T extends Summary>(
  db: PrismaClient,
  input: MutationInput,
  authorize: (tx: Tx) => Promise<void>,
  write: (tx: Tx) => Promise<T>,
): Promise<MutationOutcome<T>> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE`;
    await authorize(tx);

    const stored = await tx.rosterMutation.findUnique({ where: { requestId: input.requestId } });
    if (stored) {
      return replayReceipt<T>(stored, {
        actorUserId: input.actor.userId,
        kind: input.kind,
        payloadHash: input.payloadHash,
      });
    }

    const control = await tx.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    if (control.version !== input.expectedVersion) {
      throw new DomainError("VERSION_CONFLICT", "다른 변경이 먼저 반영되었습니다. 새로고침 후 다시 시도하세요.");
    }

    const result = await write(tx);
    const updated = await tx.rosterControl.update({
      where: { id: 1 },
      data: { version: { increment: 1 } },
    });

    await tx.rosterMutation.create({
      data: {
        requestId: input.requestId,
        actorUserId: input.actor.userId,
        kind: input.kind,
        payloadHash: input.payloadHash,
        result,
        version: updated.version,
        changed: result.changed,
      },
    });

    return {
      result,
      receipt: { requestId: input.requestId, version: updated.version, changed: result.changed },
    };
  }, ROSTER_TX);
}

/**
 * 사용자 한 행을 고치는 경로 전용. control 행은 공유 잠금만 잡아 진행 중인
 * 전환·Excel 확정 뒤에 서되 서로를 막지 않고, 충돌은 대상 User 행의
 * profileVersion으로 판정한다. control version은 올리지 않는다.
 */
export async function withUserMutation<T extends Summary>(
  db: PrismaClient,
  input: RowMutationInput,
  authorize: (tx: Tx) => Promise<void>,
  write: (tx: Tx) => Promise<T>,
): Promise<MutationOutcome<T>> {
  const identity = {
    actorUserId: input.actor.userId,
    kind: input.kind,
    payloadHash: input.payloadHash,
  };

  try {
    return await runUserMutation(db, input, identity, authorize, write);
  } catch (error) {
    // control 행을 공유 잠금만 하므로 같은 requestId의 두 트랜잭션이 나란히
    // 재전송 검사를 통과할 수 있다. 진 쪽은 RosterMutation PK 충돌로 롤백되며,
    // 트랜잭션이 이미 중단된 상태라 기록은 트랜잭션 밖에서 다시 읽는다.
    if (!isRequestIdConflict(error)) throw error;

    const stored = await db.rosterMutation.findUnique({ where: { requestId: input.requestId } });
    if (!stored) throw error;
    return replayReceipt<T>(stored, identity);
  }
}

const ROSTER_MUTATION_PK = "RosterMutation_pkey";

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readObject(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * write가 일으킨 다른 unique 위반(좌석·emailKey 등)을 재전송으로 오인하지 않도록,
 * RosterMutation의 requestId PK 위반임이 증명될 때만 참이다. pg 어댑터는 원본
 * 제약 이름을 meta.driverAdapterError.cause.originalMessage에 담아 준다.
 */
function isRequestIdConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (readString(error.meta, "modelName") !== "RosterMutation") return false;

  const cause = readObject(readObject(error.meta, "driverAdapterError"), "cause");
  return readString(cause, "originalMessage")?.includes(ROSTER_MUTATION_PK) ?? false;
}

async function runUserMutation<T extends Summary>(
  db: PrismaClient,
  input: RowMutationInput,
  identity: { actorUserId: number | null; kind: string; payloadHash: string },
  authorize: (tx: Tx) => Promise<void>,
  write: (tx: Tx) => Promise<T>,
): Promise<MutationOutcome<T>> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR SHARE`;
    await authorize(tx);

    const stored = await tx.rosterMutation.findUnique({ where: { requestId: input.requestId } });
    if (stored) {
      return replayReceipt<T>(stored, identity);
    }

    const locked = await tx.$queryRaw<{ id: number; profileVersion: number }[]>`
      SELECT id, "profileVersion" FROM "User" WHERE id = ${input.userId} FOR UPDATE
    `;
    const target = locked[0];
    if (!target) {
      throw new DomainError("MISSING_PROFILE", "대상 사용자를 찾을 수 없습니다.");
    }
    if (target.profileVersion !== input.expectedRowVersion) {
      throw new DomainError("VERSION_CONFLICT", "다른 변경이 먼저 반영되었습니다. 새로고침 후 다시 시도하세요.");
    }

    const result = await write(tx);
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { profileVersion: { increment: 1 } },
      select: { profileVersion: true },
    });

    await tx.rosterMutation.create({
      data: {
        requestId: input.requestId,
        actorUserId: input.actor.userId,
        kind: input.kind,
        payloadHash: input.payloadHash,
        result,
        version: updated.profileVersion,
        changed: result.changed,
      },
    });

    return {
      result,
      receipt: { requestId: input.requestId, version: updated.profileVersion, changed: result.changed },
    };
  }, USER_TX);
}
