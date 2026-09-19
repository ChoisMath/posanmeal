import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { dateKeyToUtcDate } from "@/lib/date-range";
import type { MealKind } from "@/lib/meal-kind";
import { assertActor } from "./access";
import type { Actor, MutationInput, MutationReceipt } from "./contracts";
import type { Db, Tx } from "./db";
import { DomainError } from "./errors";
import {
  proveCheckIn,
  type ProofEligibilityEvent,
  type ProofAccessEvent,
  type SnapshotEvidence,
} from "./kiosk-snapshot";
import { USER_TX } from "./mutation";

const CHECK_IN_TYPES = new Set(["STUDENT", "WORK", "PERSONAL"]);
const MEAL_KINDS = new Set(["BREAKFAST", "LUNCH", "DINNER"]);

/** 자격 변경이 근거 발급과 겹칠 수 있는 폭. `proveCheckIn`과 같은 값을 쓴다. */
const EVENT_OVERLAP_MS = 60_000;

const MAX_RAW_LEGACY_BYTES = 8 * 1024;

export const CLIENT_KEY_REUSED_REASON = "같은 기기 번호로 다른 기록이 이미 접수됨";

export type UploadedCheckIn = {
  clientId: number;
  deviceId?: string;
  userId: number;
  date: string;
  mealKind?: string;
  checkedAt: string;
  type: string;
  snapshotId?: string;
  rawLegacy?: unknown;
};

export type UploadStatus = "ACCEPTED" | "DUPLICATE" | "REVIEW" | "REJECTED";

export type UploadDecision = {
  status: UploadStatus;
  clientId: number;
  reviewId?: string;
  reason?: string;
  /** 참이면 장치가 로컬 미전송 목록에서 지워도 된다. REVIEW만 거짓이다. */
  final: boolean;
};

type NormalizedItem = {
  userId: number;
  date: string;
  dateObj: Date;
  mealKind: string | null;
  checkedAt: Date;
  type: "STUDENT" | "WORK" | "PERSONAL";
  snapshotId: string | null;
};

export type UploadBatch = {
  snapshots: Map<string, SnapshotEvidence | null>;
  knownUserIds: Set<number>;
  accessEvents: ProofAccessEvent[];
  eligibilityEvents: ProofEligibilityEvent[];
};

/**
 * 한 번 올라온 묶음이 쓰는 조회를 미리 한 번씩만 한다. 항목마다 근거·명단·사건을
 * 다시 읽으면 오프라인 하루치 수백 건이 그만큼 왕복한다.
 */
export async function prepareUploadBatch(db: Db, items: UploadedCheckIn[]): Promise<UploadBatch> {
  const userIds = [...new Set(items.map((item) => item.userId).filter((id) => Number.isInteger(id)))];
  const snapshotIds = [...new Set(items.map((item) => item.snapshotId).filter((id): id is string => !!id))];

  const [snapshotRows, users] = await Promise.all([
    snapshotIds.length === 0
      ? Promise.resolve([])
      : db.kioskSnapshot.findMany({
          where: { id: { in: snapshotIds } },
          select: { id: true, payload: true },
        }),
    userIds.length === 0
      ? Promise.resolve([])
      : db.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }),
  ]);

  const snapshots = new Map<string, SnapshotEvidence | null>(snapshotIds.map((id) => [id, null]));
  let minIssuedAt: number | null = null;
  let minEventId: number | null = null;
  for (const row of snapshotRows) {
    const evidence = { id: row.id, ...(row.payload as unknown as Omit<SnapshotEvidence, "id">) };
    snapshots.set(row.id, evidence);
    const issued = new Date(evidence.issuedAt).getTime();
    minIssuedAt = minIssuedAt === null ? issued : Math.min(minIssuedAt, issued);
    minEventId =
      minEventId === null
        ? evidence.lastEligibilityEventId
        : Math.min(minEventId, evidence.lastEligibilityEventId);
  }

  const [accessEvents, eligibilityEvents] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve([])
      : db.userAccessEvent.findMany({
          where: { userId: { in: userIds } },
          select: { id: true, userId: true, effectiveAt: true },
        }),
    minIssuedAt === null || minEventId === null
      ? Promise.resolve([])
      : db.eligibilityEvent.findMany({
          where: {
            OR: [
              { id: { gt: minEventId } },
              { createdAt: { gte: new Date(minIssuedAt - EVENT_OVERLAP_MS) } },
            ],
            AND: [{ OR: [{ userId: { in: userIds } }, { userId: null }] }],
          },
          select: { id: true, userId: true, applicationId: true, occurredAt: true, createdAt: true },
        }),
  ]);

  return {
    snapshots,
    knownUserIds: new Set(users.map((user) => user.id)),
    accessEvents,
    eligibilityEvents,
  };
}

/**
 * 오프라인에서 찍혀 늦게 올라온 기록 한 건의 처리. 어떤 결과든 흔적을 남긴다 —
 * 반영하면 체크인 행이, 판단할 수 없으면 payload를 담은 검토 행이 남는다.
 * 조용히 버리는 갈래는 없다.
 */
export async function processUploadedCheckIn(
  db: PrismaClient,
  actor: Actor,
  item: UploadedCheckIn,
  batch?: UploadBatch,
): Promise<UploadDecision> {
  const hash = payloadFingerprint(item);
  const clientKey = item.deviceId ? `${item.deviceId}:${item.clientId}` : `legacy:${hash}`;
  const run = () => db.$transaction(async (tx) => {
    await assertActor(tx, actor, "WRITE_ADMIN");
    const claim = await claimReview(tx, clientKey, hash, item, "판정 중");

    if (claim.review.payloadHash !== hash) {
      const conflict = await claimReview(tx, `${clientKey}#${hash}`, hash, item, CLIENT_KEY_REUSED_REASON);
      return storedDecision(conflict.review, item.clientId);
    }
    if (!claim.created) return storedDecision(claim.review, item.clientId);

    const reviewId = claim.review.id;
    const normalized = normalizeItem(item);
    if (!normalized) return finish(tx, reviewId, null, "REJECTED", "INVALID_PAYLOAD", item.clientId);

    const context = batch ?? (await prepareUploadBatch(tx, [item]));
    if (!context.knownUserIds.has(normalized.userId)) {
      return finish(tx, reviewId, null, "REJECTED", "USER_NOT_FOUND", item.clientId);
    }

    const snapshot = normalized.snapshotId ? context.snapshots.get(normalized.snapshotId) ?? null : null;
    const proof = proveCheckIn(
      snapshot,
      {
        userId: normalized.userId,
        date: normalized.date,
        mealKind: normalized.mealKind,
        checkedAt: normalized.checkedAt,
        type: normalized.type,
      },
      { accessEvents: context.accessEvents, eligibilityEvents: context.eligibilityEvents },
    );
    if (!proof.proven) {
      return finish(tx, reviewId, snapshot?.id ?? null, "PENDING", proof.reason, item.clientId);
    }
    return commitProvenCheckIn(tx, reviewId, snapshot?.id ?? null, normalized, item.clientId);
  }, USER_TX);

  try {
    return await run();
  } catch (error) {
    // 자연키 insert 경쟁은 claim까지 rollback한다. 재시도도 clientKey/hash를 다시
    // 확인해야 다른 원본이 먼저 차지한 슬롯에 체크인을 반영하지 않는다.
    if (!isUniqueViolation(error)) throw error;
    return run();
  }
}

type StoredReview = {
  id: string;
  payloadHash: string;
  state: string;
  decision: Prisma.JsonValue;
  reason: string;
};

async function claimReview(
  tx: Tx,
  clientKey: string,
  hash: string,
  item: UploadedCheckIn,
  reason: string,
): Promise<{ created: boolean; review: StoredReview }> {
  // unique 선점과 행 잠금을 같은 transaction에서 처리한다. 최초 원본은 다시 쓰지
  // 않고, 승인·거절도 이 행 잠금을 쓰므로 오래된 상태로 종결 결정을 덮지 않는다.
  const inserted = await tx.localCheckInReview.createMany({
    data: [{ clientKey, payloadHash: hash, payload: item as unknown as Prisma.InputJsonObject, reason, state: "PENDING" }],
    skipDuplicates: true,
  });
  await tx.$queryRaw`SELECT "id" FROM "LocalCheckInReview" WHERE "clientKey" = ${clientKey} FOR UPDATE`;
  const review = await tx.localCheckInReview.findUniqueOrThrow({
    where: { clientKey },
    select: { id: true, payloadHash: true, state: true, decision: true, reason: true },
  });
  return { created: inserted.count === 1, review };
}

async function commitProvenCheckIn(
  tx: Tx,
  reviewId: string,
  snapshotId: string | null,
  item: NormalizedItem,
  clientId: number,
): Promise<UploadDecision> {
  const existing = await tx.checkIn.findFirst({
    where: { userId: item.userId, date: item.dateObj, mealKind: item.mealKind as MealKind },
    select: { checkedAt: true, type: true },
  });

  if (existing) {
    return sameEvent(existing, item)
      ? finish(tx, reviewId, snapshotId, "DUPLICATE", "같은 기록이 이미 반영되어 있습니다.", clientId)
      : finish(tx, reviewId, snapshotId, "PENDING", "같은 날 다른 시각·유형의 기록이 있습니다.", clientId);
  }

  await tx.checkIn.create({
    data: {
      userId: item.userId,
      date: item.dateObj,
      mealKind: item.mealKind as MealKind,
      checkedAt: item.checkedAt,
      type: item.type,
      source: "LOCAL_SYNC",
    },
  });
  return finish(tx, reviewId, snapshotId, "ACCEPTED", "근거로 확인됨", clientId);
}

async function finish(
  tx: Tx,
  reviewId: string,
  snapshotId: string | null,
  state: "ACCEPTED" | "DUPLICATE" | "PENDING" | "REJECTED",
  reason: string,
  clientId: number,
): Promise<UploadDecision> {
  await tx.localCheckInReview.update({
    where: { id: reviewId },
    data: { snapshotId, reason, state, resolvedAt: state === "PENDING" ? null : new Date() },
  });
  return { status: state === "PENDING" ? "REVIEW" : state, clientId, reviewId, reason, final: state !== "PENDING" };
}

function sameEvent(existing: { checkedAt: Date; type: string }, item: NormalizedItem): boolean {
  return existing.checkedAt.getTime() === item.checkedAt.getTime() && existing.type === item.type;
}

function storedDecision(review: StoredReview, clientId: number): UploadDecision {
  const { id: reviewId, state, decision } = review;
  const reason = readString(decision, "reason") ?? review.reason;
  if (state === "PENDING") {
    return { status: "REVIEW", clientId, reviewId, reason, final: false };
  }
  if (state === "ACCEPTED") {
    const decided = readString(decision, "decision") !== undefined;
    return { status: decided ? "ACCEPTED" : "DUPLICATE", clientId, reviewId, reason, final: true };
  }
  if (state === "DUPLICATE" || state === "REJECTED") {
    return { status: state, clientId, reviewId, reason, final: true };
  }
  return { status: "REVIEW", clientId, reviewId, reason, final: false };
}

function readString(source: Prisma.JsonValue, key: string): string | undefined {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeItem(item: UploadedCheckIn): NormalizedItem | null {
  // 옛 장치가 보내는 원본은 검토 화면에 그대로 보여 주려고 보관만 한다. 판정에는
  // 쓰지 않으며, 검토 테이블이 임의 크기 문서 저장소가 되지 않도록 상한을 둔다.
  if (item.rawLegacy !== undefined && JSON.stringify(item.rawLegacy).length > MAX_RAW_LEGACY_BYTES) {
    return null;
  }
  if (!Number.isInteger(item.userId) || typeof item.date !== "string") return null;
  if (!CHECK_IN_TYPES.has(item.type)) return null;
  if (typeof item.checkedAt !== "string") return null;

  const checkedAt = new Date(item.checkedAt);
  if (Number.isNaN(checkedAt.getTime())) return null;

  let dateObj: Date;
  try {
    dateObj = dateKeyToUtcDate(item.date);
  } catch {
    return null;
  }

  const mealKind = item.mealKind && MEAL_KINDS.has(item.mealKind) ? item.mealKind : null;
  return {
    userId: item.userId,
    date: item.date,
    dateObj,
    mealKind,
    checkedAt,
    type: item.type as NormalizedItem["type"],
    snapshotId: typeof item.snapshotId === "string" ? item.snapshotId : null,
  };
}

/**
 * 장치가 보낸 값이 아니라 서버가 정규화한 내용만으로 계산한다. 기록 번호는 빼서
 * 같은 사건을 두 번 세지 않고, deviceId가 없는 옛 장치의 키를 이 값으로 만든다.
 */
function payloadFingerprint(item: UploadedCheckIn): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        userId: item.userId,
        date: item.date,
        mealKind: item.mealKind ?? null,
        checkedAt: item.checkedAt,
        type: item.type,
        snapshotId: item.snapshotId ?? null,
      }),
    )
    .digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code === "P2002"
      : typeof error === "object" && error !== null && "code" in error &&
        (error as { code: unknown }).code === "P2002"
  );
}

export type ResolveReviewInput = MutationInput & {
  reviewId: string;
  decision: "ACCEPT" | "REJECT";
  reason: string;
  mealKind?: string;
};

/**
 * 관리자의 최종 판단. 충돌은 전역 명부 버전이 아니라 이 검토 행의 상태로 본다 —
 * 검토는 명부 전환과 무관하고, 명부가 바뀔 때마다 밀린 검토가 못 쓰게 되면 안 된다.
 * `expectedVersion`은 계약 모양을 맞추기 위해서만 받고 쓰지 않는다.
 */
export async function resolveCheckInReview(
  db: PrismaClient,
  input: ResolveReviewInput,
): Promise<MutationReceipt> {
  return db.$transaction(async (tx) => {
    await assertActor(tx, input.actor, "WRITE_ADMIN");

    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "LocalCheckInReview" WHERE "id" = ${input.reviewId} FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new DomainError("NOT_FOUND", "검토 기록을 찾을 수 없습니다.");
    }

    const review = await tx.localCheckInReview.findUniqueOrThrow({ where: { id: input.reviewId } });
    if (readString(review.decision, "requestId") === input.requestId) {
      return { requestId: input.requestId, version: 0, changed: 1 };
    }
    if (review.state !== "PENDING") {
      throw new DomainError("VERSION_CONFLICT", "이미 처리된 검토입니다. 목록을 새로고침하세요.");
    }

    const state =
      input.decision === "REJECT"
        ? "REJECTED"
        : await insertDecidedCheckIn(tx, review.payload, input.mealKind);

    await tx.localCheckInReview.update({
      where: { id: input.reviewId },
      data: {
        state,
        resolvedAt: new Date(),
        decision: {
          requestId: input.requestId,
          decision: input.decision,
          reason: input.reason,
          actorUserId: input.actor.userId,
          decidedAt: new Date().toISOString(),
        },
      },
    });

    return { requestId: input.requestId, version: 0, changed: 1 };
  }, USER_TX);
}

async function insertDecidedCheckIn(
  tx: Tx,
  payload: Prisma.JsonValue,
  fallbackMealKind: string | undefined,
): Promise<"ACCEPTED" | "DUPLICATE"> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new DomainError("INVALID_INPUT", "보관된 기록 내용이 없어 승인할 수 없습니다.");
  }

  const stored = payload as unknown as UploadedCheckIn;
  const mealKind = stored.mealKind ?? fallbackMealKind;
  if (!mealKind || !MEAL_KINDS.has(mealKind)) {
    throw new DomainError("INVALID_INPUT", "반영할 식사 구분을 선택하세요.");
  }

  const normalized = normalizeItem({ ...stored, mealKind });
  if (!normalized) {
    throw new DomainError("INVALID_INPUT", "보관된 기록 내용을 반영할 수 없습니다.");
  }

  const taken = await tx.checkIn.findFirst({
    where: { userId: normalized.userId, date: normalized.dateObj, mealKind: mealKind as MealKind },
    select: { id: true },
  });
  if (taken) return "DUPLICATE";

  await tx.checkIn.create({
    data: {
      userId: normalized.userId,
      date: normalized.dateObj,
      mealKind: mealKind as MealKind,
      checkedAt: normalized.checkedAt,
      type: normalized.type,
      source: "LOCAL_SYNC",
    },
  });
  return "ACCEPTED";
}
