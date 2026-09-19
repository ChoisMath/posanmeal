import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";
import { assertActor } from "./access";
import { academicYearOfDate, addDaysToDateKey, kstDateKey, nextKstMidnight } from "./calendar";
import type { Actor, MemberState } from "./contracts";
import type { Db } from "./db";
import { getReportProfilesByYear } from "./report-profile";
import { activeYear } from "./roster-service";
import { sqlStateOf } from "./mutation";

/** 키오스크가 한 번 내려받은 명부로 찍을 수 있는 마지막 날. 오늘 + 13일이다. */
export const SNAPSHOT_COVERAGE_DAYS = 13;

/**
 * 발급 직전에 들어온 자격 변경이 스냅샷 안에 들어갔는지 id만으로는 알 수 없다
 * (id는 커밋 순서가 아니라 채번 순서다). 그 경계를 넉넉히 덮는 여유 시간.
 */
const EVENT_OVERLAP_MS = 60_000;

export type SnapshotUser = {
  userId: number;
  role: "STUDENT" | "TEACHER";
  accessState: "ACTIVE";
  /** 발급 시점에 확인한 마지막 이용 상태 기록. 없으면 0이다. */
  accessEventId: number;
};

/**
 * 키오스크가 화면에 쓰는 값만 담는다. 성별·담당 과목·담임·직위는 표시에도
 * 증명에도 쓰이지 않으므로 근거에 남기지 않는다.
 */
export type SnapshotProfile = {
  userId: number;
  year: number;
  role: "STUDENT" | "TEACHER";
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  memberState: MemberState;
};

export type SnapshotEligible = {
  userId: number;
  applicationId: number;
  registrationId: number;
  date: string;
  mealKind: string;
};

export type SnapshotEvidence = {
  id: string;
  version: number;
  lastEligibilityEventId: number;
  activeYear: number;
  issuedAt: string;
  freshUntil: string;
  coversUntil: string;
  users: SnapshotUser[];
  eligible: SnapshotEligible[];
  profiles: SnapshotProfile[];
};

type SnapshotPayload = Omit<SnapshotEvidence, "id">;

/**
 * 키오스크에 건네는 근거 한 벌. 발급 뒤에는 고치지 않는다 — 나중에 올라온 기록을
 * 그때의 명부로 판정하려면, 그 명부가 그때 모습 그대로 남아 있어야 한다.
 *
 * control 행은 공유 잠금만 잡는다. 진행 중인 전환 중간 상태를 내려보내지 않기
 * 위해서이고, 체크인 경로는 이 함수를 부르지 않으므로 식당 줄을 막지 않는다.
 */
export async function issueKioskSnapshot(
  db: PrismaClient,
  actor: Actor,
  now: Date,
): Promise<SnapshotEvidence> {
  return (await issueKioskDownload(db, actor, now, { includeFaces: false })).snapshot;
}

export type KioskSnapshotDownload = {
  snapshot: SnapshotEvidence;
  users: Array<{
    id: number; name: string; role: "STUDENT" | "TEACHER";
    grade: number | null; classNum: number | null; number: number | null;
  }>;
  settings: Array<{ key: string; value: string }>;
  faceProfiles: Array<{ userId: number; embeddings: Prisma.JsonValue }> | null;
};

export async function issueKioskDownload(
  db: PrismaClient,
  actor: Actor,
  now: Date,
  options: { includeFaces: boolean },
): Promise<KioskSnapshotDownload> {
  const today = kstDateKey(now);
  const coversUntil = addDaysToDateKey(today, SNAPSHOT_COVERAGE_DAYS);
  const collect = () => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR SHARE`;
    await assertActor(tx, actor, "WRITE_ADMIN");

    // 실제 내려줄 명단·얼굴과 영속 증거가 다른 시점을 읽으면 방금 동기화한 기기도
    // 취소된 자격으로 성공을 표시할 수 있다. 한 읽기 snapshot에서 모두 수집한다.
    const [control, year, users, accessEvents, eligible, lastEvent, settings, faceProfiles] = await Promise.all([
      tx.rosterControl.findUniqueOrThrow({ where: { id: 1 } }),
      activeYear(tx),
      tx.user.findMany({
        where: { accessState: "ACTIVE", role: { in: ["STUDENT", "TEACHER"] } },
        select: { id: true, name: true, role: true, grade: true, classNum: true, number: true },
      }),
      tx.userAccessEvent.groupBy({ by: ["userId"], _max: { id: true } }),
      readConfirmedEligibility(tx, today, coversUntil),
      tx.eligibilityEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } }),
      tx.systemSetting.findMany({ select: { key: true, value: true } }),
      options.includeFaces
        ? tx.faceProfile.findMany({
            where: { modelVersion: FACE_MODEL_VERSION, user: { accessState: "ACTIVE" } },
            select: { userId: true, embeddings: true },
          })
        : Promise.resolve(null),
    ]);

    const lastAccessEventId = new Map(accessEvents.map((row) => [row.userId, row._max.id ?? 0]));
    const snapshotUsers: SnapshotUser[] = users.map((user) => ({
      userId: user.id,
      role: user.role,
      accessState: "ACTIVE",
      accessEventId: lastAccessEventId.get(user.id) ?? 0,
    }));
    const profiles = await readCoverageProfiles(tx, snapshotUsers.map((user) => user.userId), today, coversUntil);
    const payload: SnapshotPayload = {
      version: control.version,
      lastEligibilityEventId: lastEvent?.id ?? 0,
      activeYear: year,
      issuedAt: now.toISOString(),
      freshUntil: nextKstMidnight(now).toISOString(),
      coversUntil,
      users: snapshotUsers,
      eligible,
      profiles,
    };
    const row = await tx.kioskSnapshot.create({
      data: {
        version: payload.version,
        activeYear: payload.activeYear,
        lastEligibilityEventId: payload.lastEligibilityEventId,
        payload: payload as unknown as Prisma.InputJsonObject,
        issuedAt: now,
        freshUntil: new Date(payload.freshUntil),
        coversUntil,
      },
      select: { id: true },
    });
    return { snapshot: { id: row.id, ...payload }, users, settings, faceProfiles };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 });

  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await collect();
    } catch (error) {
      // 전환 중인 control 행 뒤에서 기다리면 첫 RR 읽기는 40001로 종료될 수 있다.
      // rollback이 확인된 충돌만 처음부터 읽고, 연결 유실은 성공 여부를 추정하지 않는다.
      const serializationFailure = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2034" || sqlStateOf(error) === "40001");
      if (!serializationFailure || attempt >= maxAttempts) throw error;
    }
  }
}

/** 저장된 근거를 다시 읽는다. 보존 기간이 지나 사라졌으면 null이다. */
export async function readKioskSnapshot(db: Db, id: string): Promise<SnapshotEvidence | null> {
  const row = await db.kioskSnapshot.findUnique({ where: { id }, select: { id: true, payload: true } });
  if (!row) return null;
  return { id: row.id, ...(row.payload as unknown as SnapshotPayload) };
}

async function readConfirmedEligibility(
  db: Db,
  fromDateKey: string,
  toDateKey: string,
): Promise<SnapshotEligible[]> {
  const rows = await db.mealRegistrationMealDate.findMany({
    where: {
      date: { gte: dateKeyToUtcDate(fromDateKey), lte: dateKeyToUtcDate(toDateKey) },
      registration: { status: "APPROVED" },
    },
    select: {
      date: true,
      mealKind: true,
      registrationId: true,
      registration: { select: { userId: true, applicationId: true } },
    },
  });

  return rows.map((row) => ({
    userId: row.registration.userId,
    applicationId: row.registration.applicationId,
    registrationId: row.registrationId,
    date: row.date.toISOString().slice(0, 10),
    mealKind: row.mealKind,
  }));
}

/**
 * 덮는 기간이 3월 1일을 넘으면 두 학년도가 걸린다. 날짜마다 그 날의 학년도
 * 표기를 쓰기 위해 걸치는 학년도를 모두 내려보낸다.
 */
async function readCoverageProfiles(
  db: Db,
  userIds: number[],
  fromDateKey: string,
  toDateKey: string,
): Promise<SnapshotProfile[]> {
  const years = new Set([academicYearOfDate(fromDateKey), academicYearOfDate(toDateKey)]);
  const byYear = await getReportProfilesByYear(
    db,
    new Map([...years].map((year) => [year, userIds])),
    false,
  );

  const profiles: SnapshotProfile[] = [];
  for (const perYear of byYear.values()) {
    for (const report of perYear.values()) {
      const profile = report.historical;
      if (!profile) continue;
      profiles.push({
        userId: profile.userId,
        year: profile.year,
        role: profile.role,
        name: profile.name,
        grade: profile.grade,
        classNum: profile.classNum,
        number: profile.number,
        memberState: profile.memberState,
      });
    }
  }
  return profiles;
}

export type ProofItem = {
  userId: number;
  date: string;
  mealKind: string | null;
  checkedAt: Date;
  type: string;
};

export type ProofAccessEvent = { id: number; userId: number; effectiveAt: Date };

export type ProofEligibilityEvent = {
  id: number;
  userId: number | null;
  applicationId: number | null;
  occurredAt: Date;
  createdAt: Date;
};

export type ProofEvents = {
  accessEvents: ProofAccessEvent[];
  eligibilityEvents: ProofEligibilityEvent[];
};

export type ProofOutcome =
  | { proven: true }
  | { proven: false; reason: string };

/**
 * 늦게 올라온 기록 한 건이 그때 정말 자격이 있었는지. 순수 함수다 — 판정 규칙이
 * 조회와 섞이면 "왜 이 기록이 반영됐는가"를 시험으로 고정할 수 없다.
 *
 * 입증하지 못하면 거절이 아니라 REVIEW다. 체크인 이후에 생긴 졸업·전환·신청
 * 취소는 그 시점의 자격을 무효로 만들지 않으므로 여기서 보지 않는다.
 */
export function proveCheckIn(
  snapshot: SnapshotEvidence | null,
  item: ProofItem,
  events: ProofEvents,
): ProofOutcome {
  if (!item.mealKind) return { proven: false, reason: "식사 구분이 없습니다." };
  if (!snapshot) return { proven: false, reason: "당시 명부 근거가 없습니다." };

  const issuedAt = new Date(snapshot.issuedAt);
  if (item.checkedAt.getTime() < issuedAt.getTime()) {
    return { proven: false, reason: "근거를 내려주기 전에 찍힌 기록입니다." };
  }
  if (item.date > snapshot.coversUntil) {
    return { proven: false, reason: "근거가 덮는 기간을 벗어난 날짜입니다." };
  }
  if (kstDateKey(item.checkedAt) !== item.date) {
    return { proven: false, reason: "체크인 시각과 날짜가 맞지 않습니다." };
  }

  const user = snapshot.users.find((row) => row.userId === item.userId);
  if (!user) return { proven: false, reason: "당시 명단에 없는 사용자입니다." };

  const eligible = snapshot.eligible.find(
    (row) => row.userId === item.userId && row.date === item.date && row.mealKind === item.mealKind,
  );

  if (user.role === "STUDENT") {
    if (item.type !== "STUDENT") return { proven: false, reason: "학생 기록의 유형이 맞지 않습니다." };
    if (!eligible) return { proven: false, reason: "당시 확정된 식사일이 아닙니다." };
  } else if (item.type !== "WORK" && item.type !== "PERSONAL") {
    return { proven: false, reason: "교사 기록의 유형이 맞지 않습니다." };
  }

  const accessChanged = events.accessEvents.some(
    (event) =>
      event.userId === item.userId &&
      event.id > user.accessEventId &&
      event.effectiveAt.getTime() <= item.checkedAt.getTime(),
  );
  if (accessChanged) return { proven: false, reason: "체크인 전에 이용 상태가 바뀌었습니다." };

  const overlapFrom = issuedAt.getTime() - EVENT_OVERLAP_MS;
  const eligibilityChanged = events.eligibilityEvents.some((event) => {
    const afterSnapshot =
      event.id > snapshot.lastEligibilityEventId || event.createdAt.getTime() >= overlapFrom;
    if (!afterSnapshot) return false;
    if (event.occurredAt.getTime() > item.checkedAt.getTime()) return false;
    return concernsTarget(event, item.userId, eligible?.applicationId ?? null);
  });
  if (eligibilityChanged) return { proven: false, reason: "체크인 전에 자격이 바뀌었습니다." };

  return { proven: true };
}

/** 대상을 특정할 수 없는 변경은 보수적으로 "관련 있음"으로 본다. */
function concernsTarget(
  event: ProofEligibilityEvent,
  userId: number,
  applicationId: number | null,
): boolean {
  if (event.userId === userId) return true;
  if (event.userId !== null) return false;
  if (event.applicationId === null) return true;
  return applicationId !== null && event.applicationId === applicationId;
}
