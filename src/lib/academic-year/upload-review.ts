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
  await assertActor(db, actor, "WRITE_ADMIN");

  const hash = payloadFingerprint(item);
  const deviceKey = item.deviceId ? `${item.deviceId}:${item.clientId}` : `legacy:${hash}`;

  const claimed = await db.localCheckInReview.findUnique({ where: { clientKey: deviceKey } });
  if (claimed && claimed.payloadHash === hash) {
    return storedDecision(claimed.id, claimed.state, claimed.decision, item.clientId);
  }

  // 같은 기기 번호에 다른 내용이 왔다. 기기가 번호를 다시 쓴 것인지 진짜 다른
  // 사건인지 서버는 알 수 없으므로, 이 내용만의 키로 따로 보관해 관리자가
  // 끝을 낼 수 있게 한다. 거절해 버리면 장치가 영원히 다시 보낸다.
  if (claimed) {
    const conflictKey = `${deviceKey}#${hash}`;
    const parked = await db.localCheckInReview.findUnique({ where: { clientKey: conflictKey } });
    if (parked) {
      return storedDecision(parked.id, parked.state, parked.decision, item.clientId);
    }
    const review = await recordReview(
      db,
      { clientKey: conflictKey, hash, item, snapshotId: null },
      "PENDING",
      CLIENT_KEY_REUSED_REASON,
    );
    return {
      status: "REVIEW",
      clientId: item.clientId,
      reviewId: review.id,
      reason: CLIENT_KEY_REUSED_REASON,
      final: false,
    };
  }

  const clientKey = deviceKey;
  const normalized = normalizeItem(item);
  if (!normalized) {
    await recordReview(db, { clientKey, hash, item, snapshotId: null }, "REJECTED", "INVALID_PAYLOAD");
    return { status: "REJECTED", clientId: item.clientId, reason: "INVALID_PAYLOAD", final: true };
  }

  const context = batch ?? (await prepareUploadBatch(db, [item]));
  if (!context.knownUserIds.has(normalized.userId)) {
    await recordReview(db, { clientKey, hash, item, snapshotId: null }, "REJECTED", "USER_NOT_FOUND");
    return { status: "REJECTED", clientId: item.clientId, reason: "USER_NOT_FOUND", final: true };
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

  const evidence = { clientKey, hash, item, snapshotId: snapshot?.id ?? null };
  if (!proof.proven) {
    const review = await recordReview(db, evidence, "PENDING", proof.reason);
    return { status: "REVIEW", clientId: item.clientId, reviewId: review.id, reason: proof.reason, final: false };
  }

  try {
    return await commitProvenCheckIn(db, evidence, normalized, item.clientId);
  } catch (error) {
    // 같은 자연키를 동시에 넣은 쪽이 있었다. 트랜잭션은 이미 중단됐으므로
    // 그 안에서 다시 읽지 않고, 행이 보이는 상태에서 처음부터 한 번 더 판단한다.
    if (!isUniqueViolation(error)) throw error;
    return commitProvenCheckIn(db, evidence, normalized, item.clientId);
  }
}

/**
 * 반영과 그 증거를 한 트랜잭션에 넣는다. 명부 control 행은 잡지 않는다 — 늦은
 * 업로드가 전환 잠금을 기다리면 그동안 식당 줄의 온라인 체크인까지 멈춘다.
 */
async function commitProvenCheckIn(
  db: PrismaClient,
  evidence: ReviewEvidence,
  item: NormalizedItem,
  clientId: number,
): Promise<UploadDecision> {
  return db.$transaction(async (tx) => {
    const existing = await tx.checkIn.findFirst({
      where: { userId: item.userId, date: item.dateObj, mealKind: item.mealKind as MealKind },
      select: { checkedAt: true, type: true },
    });

    if (existing) {
      return sameEvent(existing, item)
        ? finish(tx, evidence, "DUPLICATE", "같은 기록이 이미 반영되어 있습니다.", clientId)
        : finish(tx, evidence, "PENDING", "같은 날 다른 시각·유형의 기록이 있습니다.", clientId);
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

    return finish(tx, evidence, "ACCEPTED", "근거로 확인됨", clientId);
  }, USER_TX);
}

async function finish(
  tx: Tx,
  evidence: ReviewEvidence,
  state: "ACCEPTED" | "DUPLICATE" | "PENDING",
  reason: string,
  clientId: number,
): Promise<UploadDecision> {
  const review = await recordReview(tx, evidence, state, reason);
  if (state === "PENDING") {
    return { status: "REVIEW", clientId, reviewId: review.id, reason, final: false };
  }
  return { status: state, clientId, reviewId: review.id, reason, final: true };
}

/** 같은 사건인지. 시각이나 유형이 다르면 자동으로 덮어쓰지 않고 검토로 보낸다. */
function sameEvent(existing: { checkedAt: Date; type: string }, item: NormalizedItem): boolean {
  return (
    existing.checkedAt.getTime() === item.checkedAt.getTime() && existing.type === item.type
  );
}

type ReviewEvidence = {
  clientKey: string;
  hash: string;
  item: UploadedCheckIn;
  snapshotId: string | null;
};

async function recordReview(
  db: Db,
  evidence: ReviewEvidence,
  state: "ACCEPTED" | "DUPLICATE" | "PENDING" | "REJECTED",
  reason: string,
): Promise<{ id: string }> {
  const settled = await db.localCheckInReview.findUnique({
    where: { clientKey: evidence.clientKey },
    select: { id: true, state: true },
  });

  // 같은 요청이 나란히 들어와 한쪽이 먼저 반영했다면, 진 쪽의 응답(중복)이 먼저
  // 쓴 사실을 덮어쓰면 안 된다. 이미 결론이 난 행은 그대로 둔다.
  if (settled) {
    if (settled.state !== "PENDING") return settled;
    await db.localCheckInReview.update({
      where: { clientKey: evidence.clientKey },
      data: { reason, state, resolvedAt: state === "PENDING" ? null : new Date() },
    });
    return settled;
  }

  return db.localCheckInReview.create({
    data: {
      clientKey: evidence.clientKey,
      payloadHash: evidence.hash,
      payload: evidence.item as unknown as Prisma.InputJsonObject,
      snapshotId: evidence.snapshotId,
      reason,
      state,
      resolvedAt: state === "PENDING" ? null : new Date(),
    },
    select: { id: true },
  });
}

function storedDecision(
  reviewId: string,
  state: string,
  decision: Prisma.JsonValue,
  clientId: number,
): UploadDecision {
  const reason = readString(decision, "reason");
  if (state === "PENDING") {
    return { status: "REVIEW", clientId, reviewId, reason, final: false };
  }
  // 이미 반영한 기록이 다시 올라온 것은 중복이다. 관리자가 직접 승인한 건만
  // ACCEPTED로 돌려줘, 장치가 "검토가 통과됐다"와 "이미 들어가 있다"를 구분한다.
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
