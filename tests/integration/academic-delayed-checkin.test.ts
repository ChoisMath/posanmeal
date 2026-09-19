import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { issueKioskSnapshot } from "@/lib/academic-year/kiosk-snapshot";
import {
  processUploadedCheckIn,
  resolveCheckInReview,
  type UploadedCheckIn,
} from "@/lib/academic-year/upload-review";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

vi.hoisted(() => {
  process.env.QR_JWT_SECRET = "test-qr-secret";
});

const ISSUED_AT = new Date("2026-09-19T00:00:00.000Z");

/** 근거 없이 올라온 옛 기록. 구조분해로 필드를 버리면 미사용 변수가 남는다. */
function omit(item: UploadedCheckIn, ...keys: Array<keyof UploadedCheckIn>): UploadedCheckIn {
  const copy = { ...item };
  for (const key of keys) delete copy[key];
  return copy;
}

function baseItem(fx: AcademicFixture, snapshotId: string): UploadedCheckIn {
  return {
    deviceId: "test-device",
    clientId: 101,
    userId: fx.studentId,
    date: "2026-09-19",
    mealKind: "DINNER",
    type: "STUDENT",
    checkedAt: "2026-09-19T09:00:00.000Z",
    snapshotId,
  };
}

describe("지연 업로드의 보수적 증명", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await db.$disconnect();
    await pgClient.end();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
  });

  it("근거로 입증된 과거 기록은 그 뒤 이용 중단이 있어도 반영하고, 재송신은 중복이다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const item = baseItem(fx, snapshot.id);

    await db.userAccessEvent.create({
      data: {
        userId: fx.studentId,
        state: "INACTIVE",
        reason: "GRADUATED",
        effectiveAt: new Date("2026-09-20T00:00:00.000Z"),
      },
    });
    await db.user.update({ where: { id: fx.studentId }, data: { accessState: "INACTIVE" } });

    expect(await processUploadedCheckIn(db, fx.main, item)).toMatchObject({
      status: "ACCEPTED",
      final: true,
    });
    expect(await processUploadedCheckIn(db, fx.main, item)).toMatchObject({
      status: "DUPLICATE",
      final: true,
    });

    const rows = await db.checkIn.findMany({
      where: { userId: fx.studentId, date: new Date("2026-09-19T00:00:00.000Z") },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("LOCAL_SYNC");
  });

  it("근거 없는 기록은 REVIEW로 보관하고, 관리자 결정 뒤 재송신은 현재 상태를 돌려준다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const legacy = omit(baseItem(fx, snapshot.id), "snapshotId");
    const undecidable = { ...legacy, clientId: 102, date: "2026-09-20", checkedAt: "2026-09-20T09:00:00.000Z" };

    const first = await processUploadedCheckIn(db, fx.main, undecidable);
    expect(first).toMatchObject({ status: "REVIEW", final: false });
    expect(first.reviewId).toBeDefined();

    expect(await processUploadedCheckIn(db, fx.main, undecidable)).toMatchObject({
      status: "REVIEW",
      final: false,
      reviewId: first.reviewId,
    });

    await resolveCheckInReview(db, {
      actor: fx.writer,
      requestId: "review-102",
      expectedVersion: 0,
      kind: "REVIEW",
      payloadHash: "review-102",
      reviewId: first.reviewId!,
      decision: "REJECT",
      reason: "확정일 없음",
    });

    expect(await processUploadedCheckIn(db, fx.main, undecidable)).toMatchObject({
      status: "REJECTED",
      final: true,
    });
    expect(await db.checkIn.count({ where: { date: new Date("2026-09-20T00:00:00.000Z") } })).toBe(0);
  });

  it("관리자 승인은 체크인을 만들고 재송신은 ACCEPTED 종결을 돌려준다", async () => {
    const legacy = omit(baseItem(fx, "none"), "snapshotId");
    const item = { ...legacy, clientId: 103 };

    const review = await processUploadedCheckIn(db, fx.main, item);
    expect(review.status).toBe("REVIEW");

    await resolveCheckInReview(db, {
      actor: fx.writer,
      requestId: "review-103",
      expectedVersion: 0,
      kind: "REVIEW",
      payloadHash: "review-103",
      reviewId: review.reviewId!,
      decision: "ACCEPT",
      reason: "담임 확인",
    });

    const stored = await db.checkIn.findFirst({
      where: { userId: fx.studentId, date: new Date("2026-09-19T00:00:00.000Z"), mealKind: "DINNER" },
    });
    expect(stored?.source).toBe("LOCAL_SYNC");

    expect(await processUploadedCheckIn(db, fx.main, item)).toMatchObject({
      status: "ACCEPTED",
      final: true,
    });
  });

  it("이미 같은 자연키가 있으면 승인은 DUPLICATE로 끝나고 오류를 내지 않는다", async () => {
    const legacy = omit(baseItem(fx, "none"), "snapshotId");
    const item = { ...legacy, clientId: 104, date: "2026-09-18", checkedAt: "2026-09-18T09:00:00.000Z" };

    const review = await processUploadedCheckIn(db, fx.main, item);
    expect(review.status).toBe("REVIEW");

    await resolveCheckInReview(db, {
      actor: fx.writer,
      requestId: "review-104",
      expectedVersion: 0,
      kind: "REVIEW",
      payloadHash: "review-104",
      reviewId: review.reviewId!,
      decision: "ACCEPT",
      reason: "담임 확인",
    });

    const row = await db.localCheckInReview.findUniqueOrThrow({ where: { id: review.reviewId! } });
    expect(row.state).toBe("DUPLICATE");
  });

  it("이미 해결된 검토를 다시 결정하면 VERSION_CONFLICT", async () => {
    const legacy = omit(baseItem(fx, "none"), "snapshotId");
    const review = await processUploadedCheckIn(db, fx.main, { ...legacy, clientId: 105 });

    const decide = (requestId: string) =>
      resolveCheckInReview(db, {
        actor: fx.writer,
        requestId,
        expectedVersion: 0,
        kind: "REVIEW",
        payloadHash: requestId,
        reviewId: review.reviewId!,
        decision: "REJECT" as const,
        reason: "중복 확인",
      });

    await decide("review-105");
    // 같은 요청키는 저장된 결과를 그대로 돌려준다.
    await expect(decide("review-105")).resolves.toMatchObject({ changed: 1 });
    await expect(decide("review-105-b")).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("payload에 mealKind가 없으면 승인에 mealKind를 요구한다", async () => {
    const noKind = omit(baseItem(fx, "none"), "snapshotId", "mealKind");
    const review = await processUploadedCheckIn(db, fx.main, { ...noKind, clientId: 106 });
    expect(review.status).toBe("REVIEW");

    await expect(
      resolveCheckInReview(db, {
        actor: fx.writer,
        requestId: "review-106",
        expectedVersion: 0,
        kind: "REVIEW",
        payloadHash: "review-106",
        reviewId: review.reviewId!,
        decision: "ACCEPT",
        reason: "확인",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await resolveCheckInReview(db, {
      actor: fx.writer,
      requestId: "review-106b",
      expectedVersion: 0,
      kind: "REVIEW",
      payloadHash: "review-106b",
      reviewId: review.reviewId!,
      decision: "ACCEPT",
      reason: "확인",
      mealKind: "DINNER",
    });

    expect(
      await db.checkIn.count({
        where: { userId: fx.studentId, date: new Date("2026-09-19T00:00:00.000Z"), mealKind: "DINNER" },
      }),
    ).toBe(1);
  });

  it("읽기 전용 관리자는 검토를 해결할 수 없다", async () => {
    const reader = await db.user.create({
      data: {
        email: "subadmin-delayed@example.posan.kr",
        name: "부관리자",
        role: "TEACHER",
        adminLevel: "SUBADMIN",
      },
    });
    const legacy = omit(baseItem(fx, "none"), "snapshotId");
    const review = await processUploadedCheckIn(db, fx.main, { ...legacy, clientId: 107 });

    await expect(
      resolveCheckInReview(db, {
        actor: { kind: "USER", userId: reader.id, sessionVersion: reader.sessionVersion },
        requestId: "review-107",
        expectedVersion: 0,
        kind: "REVIEW",
        payloadHash: "review-107",
        reviewId: review.reviewId!,
        decision: "ACCEPT",
        reason: "확인",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("교사 WORK/PERSONAL은 학생 신청 없이도 근거만으로 반영한다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const decision = await processUploadedCheckIn(db, fx.main, {
      deviceId: "test-device",
      clientId: 201,
      userId: fx.teacherId,
      date: "2026-09-19",
      mealKind: "DINNER",
      type: "WORK",
      checkedAt: "2026-09-19T09:00:00.000Z",
      snapshotId: snapshot.id,
    });

    expect(decision).toMatchObject({ status: "ACCEPTED", final: true });
  });

  it("체크인 시각 이전의 이용 중단은 REVIEW로 보관한다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    await db.userAccessEvent.create({
      data: {
        userId: fx.studentId,
        state: "INACTIVE",
        reason: "TRANSFERRED",
        effectiveAt: new Date("2026-09-19T05:00:00.000Z"),
      },
    });

    const decision = await processUploadedCheckIn(db, fx.main, baseItem(fx, snapshot.id));
    expect(decision).toMatchObject({ status: "REVIEW", final: false });
  });

  it("같은 기기 번호에 다른 내용이 오면 따로 보관해 관리자가 끝낼 수 있게 한다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const item = baseItem(fx, snapshot.id);
    await processUploadedCheckIn(db, fx.main, item);

    const conflicting = { ...item, checkedAt: "2026-09-19T10:00:00.000Z" };
    const parked = await processUploadedCheckIn(db, fx.main, conflicting);
    expect(parked).toMatchObject({ status: "REVIEW", final: false });
    expect(parked.reviewId).toBeDefined();

    // 같은 충돌 내용을 다시 보내면 새 검토가 생기지 않고 같은 행을 가리킨다.
    expect(await processUploadedCheckIn(db, fx.main, conflicting)).toMatchObject({
      status: "REVIEW",
      reviewId: parked.reviewId,
    });
    expect(await db.localCheckInReview.count()).toBe(2);

    const listed = await db.localCheckInReview.findUniqueOrThrow({ where: { id: parked.reviewId! } });
    expect(listed.state).toBe("PENDING");

    await resolveCheckInReview(db, {
      actor: fx.writer,
      requestId: "review-conflict",
      expectedVersion: 0,
      kind: "REVIEW",
      payloadHash: "review-conflict",
      reviewId: parked.reviewId!,
      decision: "REJECT",
      reason: "기기 번호 재사용",
    });

    expect(await processUploadedCheckIn(db, fx.main, conflicting)).toMatchObject({
      status: "REJECTED",
      final: true,
    });
  });

  it("8KB를 넘는 원본은 형식 오류로 거절하고, 작은 원본은 검토 payload에 그대로 보관한다", async () => {
    const legacy = omit(baseItem(fx, "none"), "snapshotId");

    const tooBig = await processUploadedCheckIn(db, fx.main, {
      ...legacy,
      clientId: 701,
      rawLegacy: { note: "가".repeat(9000) },
    });
    expect(tooBig).toMatchObject({ status: "REJECTED", reason: "INVALID_PAYLOAD", final: true });

    const kept = await processUploadedCheckIn(db, fx.main, {
      ...legacy,
      clientId: 702,
      rawLegacy: { note: "옛 기록" },
    });
    const row = await db.localCheckInReview.findUniqueOrThrow({ where: { id: kept.reviewId! } });
    expect(row.payload).toMatchObject({ rawLegacy: { note: "옛 기록" } });
  });

  it("없는 검토를 결정하면 NOT_FOUND", async () => {
    await expect(
      resolveCheckInReview(db, {
        actor: fx.writer,
        requestId: "review-missing",
        expectedVersion: 0,
        kind: "REVIEW",
        payloadHash: "review-missing",
        reviewId: "does-not-exist",
        decision: "REJECT",
        reason: "없음",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("근거 발급 전·범위 밖·날짜 불일치 기록은 REVIEW다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const item = baseItem(fx, snapshot.id);

    const beforeIssue = await processUploadedCheckIn(db, fx.main, {
      ...item,
      clientId: 301,
      date: "2026-09-18",
      checkedAt: "2026-09-18T09:00:00.000Z",
    });
    expect(beforeIssue.status).toBe("REVIEW");

    const beyondCoverage = await processUploadedCheckIn(db, fx.main, {
      ...item,
      clientId: 302,
      date: "2026-10-30",
      checkedAt: "2026-10-30T09:00:00.000Z",
    });
    expect(beyondCoverage.status).toBe("REVIEW");

    const dateMismatch = await processUploadedCheckIn(db, fx.main, {
      ...item,
      clientId: 303,
      date: "2026-09-19",
      checkedAt: "2026-09-21T09:00:00.000Z",
    });
    expect(dateMismatch.status).toBe("REVIEW");
  });

  it("freshUntil 이후라도 범위 안이고 사이 변경이 없으면 반영한다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, new Date("2026-09-18T01:00:00.000Z"));
    expect(new Date(snapshot.freshUntil).getTime()).toBeLessThan(
      new Date("2026-09-19T09:00:00.000Z").getTime(),
    );

    const decision = await processUploadedCheckIn(db, fx.main, baseItem(fx, snapshot.id));
    expect(decision).toMatchObject({ status: "ACCEPTED", final: true });
  });

  it("사이에 낀 자격 변경은 당사자 것만 REVIEW로 보낸다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);

    const other = await db.user.create({
      data: { email: "other-delayed@example.posan.kr", name: "다른학생", role: "STUDENT", grade: 1 },
    });
    await db.eligibilityEvent.create({
      data: {
        scope: "REGISTRATION",
        applicationId: fx.applicationId,
        userId: other.id,
        occurredAt: new Date("2026-09-19T05:00:00.000Z"),
      },
    });
    expect(await processUploadedCheckIn(db, fx.main, baseItem(fx, snapshot.id))).toMatchObject({
      status: "ACCEPTED",
    });

    await db.eligibilityEvent.create({
      data: {
        scope: "REGISTRATION",
        applicationId: fx.applicationId,
        userId: fx.studentId,
        occurredAt: new Date("2026-09-19T05:00:00.000Z"),
      },
    });
    const mine = await processUploadedCheckIn(db, fx.main, { ...baseItem(fx, snapshot.id), clientId: 401 });
    expect(mine).toMatchObject({ status: "REVIEW", reason: "체크인 전에 자격이 바뀌었습니다." });
  });

  it("대상을 알 수 없는 자격 변경도 REVIEW로 보낸다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    await db.eligibilityEvent.create({
      data: { scope: "APPLICATION", occurredAt: new Date("2026-09-19T05:00:00.000Z") },
    });

    expect(await processUploadedCheckIn(db, fx.main, baseItem(fx, snapshot.id))).toMatchObject({
      status: "REVIEW",
    });
  });

  it("근거가 보존 기간 경과로 사라지면 REVIEW다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    await db.kioskSnapshot.delete({ where: { id: snapshot.id } });

    expect(await processUploadedCheckIn(db, fx.main, baseItem(fx, snapshot.id))).toMatchObject({
      status: "REVIEW",
    });
  });

  it("알 수 없는 사용자와 형식이 깨진 payload는 REJECTED다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);

    expect(
      await processUploadedCheckIn(db, fx.main, { ...baseItem(fx, snapshot.id), clientId: 501, userId: 999999 }),
    ).toMatchObject({ status: "REJECTED", final: true, reason: "USER_NOT_FOUND" });

    expect(
      await processUploadedCheckIn(db, fx.main, { ...baseItem(fx, snapshot.id), clientId: 502, date: "not-a-date" }),
    ).toMatchObject({ status: "REJECTED", final: true, reason: "INVALID_PAYLOAD" });
  });

  it("deviceId가 없는 기록도 재송신이 검토를 늘리지 않는다", async () => {
    const legacy = omit(baseItem(fx, "none"), "snapshotId", "deviceId");

    const first = await processUploadedCheckIn(db, fx.main, { ...legacy, clientId: 601 });
    const again = await processUploadedCheckIn(db, fx.main, { ...legacy, clientId: 602 });

    expect(first.status).toBe("REVIEW");
    expect(again.reviewId).toBe(first.reviewId);
    expect(await db.localCheckInReview.count()).toBe(1);
  });

  it("스냅샷은 발급 시점 근거를 담고 이후 바뀌지 않는다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);

    expect(snapshot.coversUntil).toBe("2026-10-02");
    expect(snapshot.users.map((u) => u.userId).sort()).toEqual([fx.studentId, fx.teacherId].sort());
    expect(snapshot.eligible).toContainEqual(
      expect.objectContaining({ userId: fx.studentId, date: "2026-09-19", mealKind: "DINNER" }),
    );
    const profile = snapshot.profiles.find((p) => p.userId === fx.studentId);
    expect(Object.keys(profile!).sort()).toEqual([
      "classNum", "grade", "memberState", "name", "number", "role", "userId", "year",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("embedding");

    const stored = await db.kioskSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    await db.user.update({ where: { id: fx.studentId }, data: { accessState: "INACTIVE" } });
    const reissued = await issueKioskSnapshot(db, fx.main, ISSUED_AT);

    expect(reissued.id).not.toBe(snapshot.id);
    const unchanged = await db.kioskSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(unchanged.payload).toEqual(stored.payload);
    expect(reissued.users.map((u) => u.userId)).toEqual([fx.teacherId]);
  });

  it("체크인은 RosterControl 잠금을 기다리지 않는다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);

    await pgClient.query("BEGIN");
    try {
      await pgClient.query('SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE');
      const decision = await processUploadedCheckIn(db, fx.main, baseItem(fx, snapshot.id));
      expect(decision.status).toBe("ACCEPTED");
    } finally {
      await pgClient.query("ROLLBACK");
    }
  });
});

describe("PREPARING 모드", () => {
  let db: PrismaClient;
  let pgClient: Client;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await db.$disconnect();
    await pgClient.end();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
  });

  it("PREPARING에서는 업로드가 기존처럼 삽입하고 검토·스냅샷을 만들지 않는다", async () => {
    const { POST } = await import("@/app/api/sync/upload/route");
    const user = await db.user.create({
      data: { email: "preparing@example.posan.kr", name: "준비중", role: "STUDENT", grade: 1 },
    });

    const res = await POST(
      new Request("http://localhost/api/sync/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkins: [
            {
              clientId: 1,
              userId: user.id,
              date: "2026-09-19",
              mealKind: "DINNER",
              checkedAt: "2026-09-19T09:00:00.000Z",
              type: "STUDENT",
            },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(body.acceptedCount).toBe(1);
    expect(body.syncedClientIds).toEqual([1]);
    expect(await db.localCheckInReview.count()).toBe(0);
    expect(await db.kioskSnapshot.count()).toBe(0);
  });
});

describe("READY 모드 라우트", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await db.$disconnect();
    await pgClient.end();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
  });

  it("동기화 내려받기는 근거를 저장해 함께 내려주고 중지된 계정을 뺀다", async () => {
    await db.user.update({ where: { id: fx.teacherId }, data: { accessState: "INACTIVE" } });

    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download?faces=1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.snapshot.id).toBeDefined();
    expect(body.users.map((u: { id: number }) => u.id)).toEqual([fx.studentId]);
    expect(body.snapshot.users.map((u: { userId: number }) => u.userId)).toEqual([fx.studentId]);
    expect(await db.kioskSnapshot.count()).toBe(1);
  });

  it("업로드는 항목별 결정을 함께 돌려주고 한 건의 충돌이 나머지를 막지 않는다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const proven = {
      clientId: 1, deviceId: "kiosk-1", userId: fx.studentId, date: "2026-09-19",
      mealKind: "DINNER", type: "STUDENT", checkedAt: "2026-09-19T09:00:00.000Z",
      snapshotId: snapshot.id,
    };
    await processUploadedCheckIn(db, fx.main, proven);

    const { POST } = await import("@/app/api/sync/upload/route");
    const res = await POST(
      new Request("http://localhost/api/sync/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkins: [
            // 같은 clientKey에 다른 시각 → 이 항목만 충돌
            { ...proven, checkedAt: "2026-09-19T10:00:00.000Z" },
            { clientId: 2, deviceId: "kiosk-1", userId: fx.teacherId, date: "2026-09-19", mealKind: "DINNER", type: "WORK", checkedAt: "2026-09-19T09:05:00.000Z", snapshotId: snapshot.id },
            { clientId: 3, deviceId: "kiosk-1", userId: fx.studentId, date: "2026-09-20", mealKind: "DINNER", type: "STUDENT", checkedAt: "2026-09-20T09:00:00.000Z" },
            { clientId: 4, deviceId: "kiosk-1", userId: 999999, date: "2026-09-19", mealKind: "DINNER", type: "STUDENT", checkedAt: "2026-09-19T09:00:00.000Z", snapshotId: snapshot.id },
            // 번호가 없는 기록은 응답으로 알려 줄 방법이 없어 처리하지 않는다.
            { deviceId: "kiosk-1", userId: fx.studentId, date: "2026-09-19", mealKind: "DINNER", type: "STUDENT", checkedAt: "2026-09-19T09:00:00.000Z", snapshotId: snapshot.id },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(body.acceptedCount).toBe(1);
    expect(body.reviewCount).toBe(2);
    expect(body.rejected).toEqual([
      expect.objectContaining({ clientId: null, reason: "NO_CLIENT_ID" }),
      expect.objectContaining({ clientId: 4, reason: "USER_NOT_FOUND" }),
    ]);
    expect(body.syncedClientIds).toEqual([2, 4]);
    expect(body.decisions).toEqual([
      expect.objectContaining({ clientId: 1, status: "REVIEW", final: false }),
      expect.objectContaining({ clientId: 2, status: "ACCEPTED", final: true }),
      expect.objectContaining({ clientId: 3, status: "REVIEW", final: false }),
      expect.objectContaining({ clientId: 4, status: "REJECTED", final: true }),
    ]);
    // 모든 결정은 REVIEW만 미종결이다.
    for (const decision of body.decisions) {
      expect(decision.final).toBe(decision.status !== "REVIEW");
    }
  });

  it("검토 API는 목록과 결정을 제공한다", async () => {
    const pending = await processUploadedCheckIn(db, fx.main, {
      clientId: 9, deviceId: "kiosk-1", userId: fx.studentId, date: "2026-09-19",
      mealKind: "DINNER", type: "STUDENT", checkedAt: "2026-09-19T09:00:00.000Z",
    });

    const { GET } = await import("@/app/api/admin/checkin-reviews/route");
    const listed = await (await GET(new Request("http://localhost/api/admin/checkin-reviews?state=PENDING"))).json();
    expect(listed.reviews).toEqual([expect.objectContaining({ id: pending.reviewId, state: "PENDING" })]);

    const { POST } = await import("@/app/api/admin/checkin-reviews/[id]/route");
    const res = await POST(
      new Request("http://localhost/api/admin/checkin-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: "route-review-9", decision: "ACCEPT", reason: "담임 확인" }),
      }),
      { params: Promise.resolve({ id: pending.reviewId! }) },
    );

    expect(res.status).toBe(200);
    expect(
      await db.checkIn.count({
        where: { userId: fx.studentId, date: new Date("2026-09-19T00:00:00.000Z"), source: "LOCAL_SYNC" },
      }),
    ).toBe(1);
  });

  it("온라인 QR 체크인은 명부 잠금을 기다리지 않고 중지된 계정을 거절한다", async () => {
    const { signQRToken } = await import("@/lib/qr-token");
    const { POST } = await import("@/app/api/checkin/route");

    const call = (userId: number) =>
      POST(
        new Request("http://localhost/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: signQRToken({ userId, role: "TEACHER", type: "WORK", mealKind: "DINNER" }),
          }),
        }),
      );

    await pgClient.query("BEGIN");
    try {
      await pgClient.query('SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE');
      const res = await call(fx.teacherId);
      expect((await res.json()).success).toBe(true);
    } finally {
      await pgClient.query("ROLLBACK");
    }

    await db.user.update({ where: { id: fx.teacherId }, data: { accessState: "INACTIVE" } });
    const refused = await call(fx.teacherId);
    expect(refused.status).toBe(403);
    expect((await refused.json()).errorCode).toBe("ACCOUNT_INACTIVE");
  });
});

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } }),
}));

vi.mock("@/lib/prisma", async () => {
  const { openAcademicTestDb: open } = await import("./support/db");
  return { prisma: await open() };
});
