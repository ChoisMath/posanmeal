import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { correctAcademicRecord, deleteArchivedRoster } from "@/lib/academic-year/archive-service";
import { DomainError } from "@/lib/academic-year/errors";
import { getAcademicProfiles } from "@/lib/academic-year/profile-service";
import { activateAcademicYear, reviewRollover } from "@/lib/academic-year/rollover-service";
import { backfill2026 } from "@/lib/academic-year/backfill";
import {
  createDraftYear,
  listRoster,
  listRosterView,
  upsertRosterProfile,
} from "@/lib/academic-year/roster-service";
import type { Profile } from "@/lib/academic-year/contracts";
import { captureLegacyFingerprint, compareLegacyFingerprints } from "../../scripts/academic-year/fingerprint";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: { current: null as unknown as PrismaClient },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key) {
        const holder = mocks.client.current as unknown as Record<string | symbol, unknown>;
        const value = holder[key];
        return typeof value === "function" ? value.bind(holder) : value;
      },
    },
  ),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));

const TODAY = "2026-09-18";
const SOURCE_YEAR = 2026;
const TARGET_YEAR = 2027;

const MAIN_SESSION = { user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } };

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function studentProfile(over: Partial<Profile> = {}): Profile {
  return {
    role: "STUDENT",
    name: "정정된이름",
    grade: 1,
    classNum: 1,
    number: 1,
    gender: "MALE",
    subject: null,
    homeroom: null,
    position: null,
    ...over,
  };
}

describe("academic archive", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
    mocks.client.current = db;
  });

  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(MAIN_SESSION);
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
  });

  /** SOURCE_YEAR을 ARCHIVED로 만들고 그 뒤 control version을 돌려준다. */
  async function archiveSourceYear(): Promise<number> {
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-archive",
      kind: "DRAFT",
      payloadHash: "draft-archive",
      expectedVersion: fx.version,
      year: TARGET_YEAR,
      sourceYear: SOURCE_YEAR,
    });
    const review = await reviewRollover(db, fx.main, TARGET_YEAR, { today: TODAY });
    const activated = await activateAcademicYear(db, {
      actor: fx.main,
      requestId: "activate-archive",
      kind: "ACTIVATE",
      payloadHash: "activate-archive",
      expectedVersion: review.version,
      year: TARGET_YEAR,
      yearVersion: review.yearVersion,
      sourceVersion: review.sourceVersion,
      kiosksPaused: true,
      warningsAcknowledged: true,
      today: TODAY,
    });
    return activated.version;
  }

  async function recordVersion(userId: number, year = SOURCE_YEAR): Promise<number> {
    return (
      await db.userAcademicRecord.findUniqueOrThrow({ where: { year_userId: { year, userId } } })
    ).version;
  }

  it("물리 명부를 지워도 표시 기록은 남고 재실행은 아무것도 만들지 않는다", async () => {
    const version = await archiveSourceYear();
    const original = await captureLegacyFingerprint(pgClient);
    const beforeProfiles = await getAcademicProfiles(db, [fx.studentId, fx.teacherId], SOURCE_YEAR);

    const receipt = await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-2026",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-hash",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });
    expect(receipt.changed).toBeGreaterThan(0);

    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);

    // 보존 기록은 삭제 전체와 그대로 deep-equal이어야 한다 — 한 사람만 살짝
    // 보는 spot check로는 다른 사람의 record가 건드려졌는지 알 수 없다.
    const afterProfiles = await getAcademicProfiles(db, [fx.studentId, fx.teacherId], SOURCE_YEAR);
    expect(afterProfiles).toEqual(beforeProfiles);

    const after = await captureLegacyFingerprint(pgClient);
    expect(compareLegacyFingerprints(original, after).equal).toBe(true);

    await backfill2026(db, original);
    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);
  });

  it("ACTIVE 학년도 삭제는 거부한다", async () => {
    await expect(
      deleteArchivedRoster(db, {
        actor: fx.main,
        requestId: "delete-active",
        expectedVersion: fx.version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "delete-active",
        year: SOURCE_YEAR,
        entryIds: "ALL",
      }),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
  });

  it("DRAFT 학년도 삭제는 거부한다", async () => {
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-only",
      kind: "DRAFT",
      payloadHash: "draft-only",
      expectedVersion: fx.version,
      year: TARGET_YEAR,
      sourceYear: SOURCE_YEAR,
    });

    await expect(
      deleteArchivedRoster(db, {
        actor: fx.main,
        requestId: "delete-draft",
        expectedVersion: fx.version + 1,
        kind: "ARCHIVE_DELETE",
        payloadHash: "delete-draft",
        year: TARGET_YEAR,
        entryIds: "ALL",
      }),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
  });

  it("교사 관리자(WRITE_ADMIN)는 삭제할 수 없다", async () => {
    const version = await archiveSourceYear();

    await expect(
      deleteArchivedRoster(db, {
        actor: fx.writer,
        requestId: "delete-by-writer",
        expectedVersion: version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "delete-by-writer",
        year: SOURCE_YEAR,
        entryIds: "ALL",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PREPARING 동안은 삭제·정정 모두 차단된다", async () => {
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });

    await expect(
      deleteArchivedRoster(db, {
        actor: fx.main,
        requestId: "delete-preparing",
        expectedVersion: fx.version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "delete-preparing",
        year: SOURCE_YEAR,
        entryIds: "ALL",
      }),
    ).rejects.toMatchObject({ code: "NOT_READY" });

    await expect(
      correctAcademicRecord(db, {
        actor: fx.main,
        requestId: "correct-preparing",
        userId: fx.studentId,
        expectedRowVersion: await recordVersion(fx.studentId),
        kind: "ROSTER_CORRECT",
        payloadHash: "correct-preparing",
        year: SOURCE_YEAR,
        profile: studentProfile(),
      }),
    ).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("낯선(다른 연도) entry id가 섞이면 아무것도 지우지 않는다", async () => {
    const version = await archiveSourceYear();

    const rows = await listRoster(db, SOURCE_YEAR, "STUDENT");
    const validId = rows[0]?.entryId;
    expect(validId).toBeTruthy();

    await expect(
      deleteArchivedRoster(db, {
        actor: fx.main,
        requestId: "delete-foreign",
        expectedVersion: version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "delete-foreign",
        year: SOURCE_YEAR,
        entryIds: [validId as string, "not-a-real-entry-id"],
      }),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });

    expect(await listRoster(db, SOURCE_YEAR)).not.toEqual([]);
  });

  it("선택 삭제는 지정한 항목만 지우고 RosterFile·RosterImport 사본은 30일 규칙에 맡긴다", async () => {
    const version = await archiveSourceYear();

    const rows = await listRoster(db, SOURCE_YEAR);
    const total = rows.length;
    expect(total).toBeGreaterThan(1);
    const target = rows[0]!;

    await db.rosterFile.create({
      data: {
        id: "file-2026-a",
        year: SOURCE_YEAR,
        version: 0,
        schemaVersion: 1,
        manifest: { schemaVersion: 1, fileId: "file-2026-a", year: SOURCE_YEAR, version: 0, rows: {} },
      },
    });
    await db.rosterImport.create({
      data: {
        id: "import-2026-a",
        year: SOURCE_YEAR,
        scope: "FULL",
        controlVersion: version,
        yearVersion: 0,
        payload: { some: "payload" },
        preview: { some: "preview" },
        state: "PREVIEW",
      },
    });

    const receipt = await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-selected",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-selected",
      year: SOURCE_YEAR,
      entryIds: [target.entryId],
    });
    expect(receipt.changed).toBe(1);

    const remaining = await listRoster(db, SOURCE_YEAR);
    expect(remaining.length).toBe(total - 1);
    expect(remaining.some((row) => row.entryId === target.entryId)).toBe(false);

    const file = await db.rosterFile.findUnique({ where: { id: "file-2026-a" } });
    expect(file).not.toBeNull();
    const importRow = await db.rosterImport.findUnique({ where: { id: "import-2026-a" } });
    expect(importRow?.payload).not.toBeNull();
    expect(importRow?.preview).not.toBeNull();
  });

  it("전체 삭제는 그 학년도의 RosterFile을 지우고 RosterImport 사본을 비우되 다른 연도는 그대로 둔다", async () => {
    const version = await archiveSourceYear();

    await db.rosterFile.create({
      data: {
        id: "file-2026-b",
        year: SOURCE_YEAR,
        version: 0,
        schemaVersion: 1,
        manifest: { schemaVersion: 1, fileId: "file-2026-b", year: SOURCE_YEAR, version: 0, rows: {} },
      },
    });
    await db.rosterImport.create({
      data: {
        id: "import-2026-b",
        year: SOURCE_YEAR,
        scope: "FULL",
        controlVersion: version,
        yearVersion: 0,
        payload: { some: "payload" },
        preview: { some: "preview" },
        state: "PREVIEW",
      },
    });
    await db.rosterFile.create({
      data: {
        id: "file-2027",
        year: TARGET_YEAR,
        version: 0,
        schemaVersion: 1,
        manifest: { schemaVersion: 1, fileId: "file-2027", year: TARGET_YEAR, version: 0, rows: {} },
      },
    });
    await db.rosterImport.create({
      data: {
        id: "import-2027",
        year: TARGET_YEAR,
        scope: "FULL",
        controlVersion: version,
        yearVersion: 0,
        payload: { some: "payload" },
        preview: { some: "preview" },
        state: "PREVIEW",
      },
    });

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-all",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-all",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    expect(await db.rosterFile.findMany({ where: { year: SOURCE_YEAR } })).toEqual([]);
    const importRow = await db.rosterImport.findUnique({ where: { id: "import-2026-b" } });
    expect(importRow?.payload).toBeNull();
    expect(importRow?.preview).toBeNull();

    const otherFile = await db.rosterFile.findUnique({ where: { id: "file-2027" } });
    expect(otherFile).not.toBeNull();
    const otherImport = await db.rosterImport.findUnique({ where: { id: "import-2027" } });
    expect(otherImport?.payload).not.toBeNull();
    expect(otherImport?.preview).not.toBeNull();
  });

  it("삭제는 Record·User·신청·체크인·안면 프로필·RosterDecision 건수를 바꾸지 않는다", async () => {
    const version = await archiveSourceYear();

    const before = {
      records: await db.userAcademicRecord.count(),
      users: await db.user.count(),
      registrations: await db.mealRegistration.count(),
      checkIns: await db.checkIn.count(),
      faceProfiles: await db.faceProfile.count(),
      decisions: await db.rosterDecision.count(),
    };

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-counts",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-counts",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    expect({
      records: await db.userAcademicRecord.count(),
      users: await db.user.count(),
      registrations: await db.mealRegistration.count(),
      checkIns: await db.checkIn.count(),
      faceProfiles: await db.faceProfile.count(),
      decisions: await db.rosterDecision.count(),
    }).toEqual(before);
  });

  it("재전송은 같은 영수증을 돌려주고, 오래된 expectedVersion은 VERSION_CONFLICT다", async () => {
    const version = await archiveSourceYear();

    const input = {
      actor: fx.main,
      requestId: "delete-replay",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-replay",
      year: SOURCE_YEAR,
      entryIds: "ALL" as const,
    };

    const first = await deleteArchivedRoster(db, input);
    const second = await deleteArchivedRoster(db, input);
    expect(second).toEqual(first);

    await expect(
      deleteArchivedRoster(db, {
        ...input,
        requestId: "delete-stale",
        expectedVersion: version,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("summary와 RosterMutation.result에는 이름·이메일이 담기지 않는다", async () => {
    const version = await archiveSourceYear();

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-no-pii",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-no-pii",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    const stored = await db.rosterMutation.findUniqueOrThrow({ where: { requestId: "delete-no-pii" } });
    const text = JSON.stringify(stored.result);
    expect(text).not.toContain("@");
    expect(text.toLowerCase()).not.toContain("학생테스트".toLowerCase());
  });

  it("명부가 없어져도 보존 기록을 정정할 수 있고 항목을 되살리지 않는다", async () => {
    await archiveSourceYear();

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-before-correct",
      expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-before-correct",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    const before = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    const currentYearRecord = await db.userAcademicRecord.findUnique({
      where: { year_userId: { year: TARGET_YEAR, userId: fx.studentId } },
    });

    const receipt = await correctAcademicRecord(db, {
      actor: fx.main,
      requestId: "correct-2026",
      userId: fx.studentId,
      expectedRowVersion: await recordVersion(fx.studentId),
      kind: "ROSTER_CORRECT",
      payloadHash: "correct-2026",
      year: SOURCE_YEAR,
      profile: studentProfile({ name: "정정된이름" }),
    });
    expect(receipt.changed).toBeGreaterThan(0);

    const corrected = (await getAcademicProfiles(db, [fx.studentId], SOURCE_YEAR)).get(fx.studentId);
    expect(corrected?.name).toBe("정정된이름");

    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);
    expect(await db.rosterEntry.count({ where: { year: SOURCE_YEAR } })).toBe(0);

    const afterUser = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    expect(afterUser.name).toBe(before.name);

    const otherYearRecord = await db.userAcademicRecord.findUnique({
      where: { year_userId: { year: TARGET_YEAR, userId: fx.studentId } },
    });
    expect(otherYearRecord).toEqual(currentYearRecord);
  });

  it("ACTIVE 학년도는 correctAcademicRecord로 정정할 수 없다", async () => {
    await expect(
      correctAcademicRecord(db, {
        actor: fx.main,
        requestId: "correct-active",
        userId: fx.studentId,
        expectedRowVersion: await recordVersion(fx.studentId),
        kind: "ROSTER_CORRECT",
        payloadHash: "correct-active",
        year: SOURCE_YEAR,
        profile: studentProfile({ name: "고쳐본이름" }),
      }),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
  });

  it("교사 관리자(WRITE_ADMIN)는 정정할 수 있고, 일반 명부 export는 정정만으로 명부를 되살리지 않는다", async () => {
    await archiveSourceYear();

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-before-writer-correct",
      expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-before-writer-correct",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    await correctAcademicRecord(db, {
      actor: fx.writer,
      requestId: "correct-by-writer",
      userId: fx.studentId,
      expectedRowVersion: await recordVersion(fx.studentId),
      kind: "ROSTER_CORRECT",
      payloadHash: "correct-by-writer",
      year: SOURCE_YEAR,
      profile: studentProfile({ name: "다시정정" }),
    });

    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);
  });

  it("upsertRosterProfile로도 지워진 보관 연도 항목을 다시 만들지 않고 기록만 고친다", async () => {
    await archiveSourceYear();

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-before-upsert",
      expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-before-upsert",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    const record = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: SOURCE_YEAR, userId: fx.studentId } },
    });
    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });

    await upsertRosterProfile(db, {
      actor: fx.main,
      requestId: "row-correct-2026",
      kind: "ROSTER_ROW",
      payloadHash: "row-correct-2026",
      expectedRowVersion: record.version,
      year: SOURCE_YEAR,
      userId: fx.studentId,
      email: student.email,
      profile: studentProfile({ name: "명부없이정정" }),
    });

    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);
    const corrected = (await getAcademicProfiles(db, [fx.studentId], SOURCE_YEAR)).get(fx.studentId);
    expect(corrected?.name).toBe("명부없이정정");
  });

  describe("listRosterView({ includeEntryless })", () => {
    it("기본값은 지워진 연도의 보존 기록을 감추고, includeEntryless는 명시적으로 보여준다", async () => {
      await archiveSourceYear();
      await deleteArchivedRoster(db, {
        actor: fx.main,
        requestId: "delete-for-entryless",
        expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "delete-for-entryless",
        year: SOURCE_YEAR,
        entryIds: "ALL",
      });

      const hidden = await listRosterView(db, SOURCE_YEAR);
      expect(hidden).toEqual([]);

      const shown = await listRosterView(db, SOURCE_YEAR, undefined, { includeEntryless: true });
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((row) => row.entryId === "")).toBe(true);
      expect(shown.some((row) => row.userId === fx.studentId)).toBe(true);
    });

    it("ACTIVE 학년도에서는 includeEntryless가 결과를 바꾸지 않는다", async () => {
      const withOption = await listRosterView(db, SOURCE_YEAR, undefined, { includeEntryless: true });
      const withoutOption = await listRosterView(db, SOURCE_YEAR);
      expect(withOption).toEqual(withoutOption);
    });
  });

  describe("선택 삭제 payloadHash 정규화", () => {
    it("같은 id 집합이면 순서가 달라도 같은 요청으로 재생되고, 다른 집합이면 REQUEST_REUSED다", async () => {
      const version = await archiveSourceYear();
      const rows = await listRoster(db, SOURCE_YEAR);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const [a, b] = [rows[0]!.entryId, rows[1]!.entryId];

      const requestId = "delete-order-insensitive";
      const first = await deleteArchivedRoster(db, {
        actor: fx.main,
        requestId,
        expectedVersion: version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "hash-1",
        year: SOURCE_YEAR,
        entryIds: [a, b].sort(),
      });

      // 서비스로 넘기는 배열 순서는 다르지만 해시가 정규화(중복 제거+정렬)된
      // 같은 값이라면 재전송으로 인정되어 다시 지우지 않고 같은 영수증을 돌려준다.
      const replay = await deleteArchivedRoster(db, {
        actor: fx.main,
        requestId,
        expectedVersion: version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "hash-1",
        year: SOURCE_YEAR,
        entryIds: [b, a].sort(),
      });
      expect(replay).toEqual(first);

      await expect(
        deleteArchivedRoster(db, {
          actor: fx.main,
          requestId,
          expectedVersion: version,
          kind: "ARCHIVE_DELETE",
          payloadHash: "hash-2",
          year: SOURCE_YEAR,
          entryIds: [a],
        }),
      ).rejects.toMatchObject({ code: "REQUEST_REUSED" });
    });
  });

  describe("roster/[year] DELETE route: payloadHash normalization at the HTTP boundary", () => {
    it("같은 선택을 다른 순서로 보내도 같은 요청으로 처리되고, 다른 선택은 REQUEST_REUSED다", async () => {
      await archiveSourceYear();
      const rows = await listRoster(db, SOURCE_YEAR);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const [a, b] = [rows[0]!.entryId, rows[1]!.entryId];
      const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });

      const roster = await import("@/app/api/admin/academic-years/[year]/roster/route");
      const requestId = "route-delete-order-insensitive";

      const first = await roster.DELETE(
        jsonRequest(`/api/admin/academic-years/${SOURCE_YEAR}/roster`, "DELETE", {
          requestId,
          expectedVersion: control.version,
          entryIds: [a, b],
        }),
        { params: Promise.resolve({ year: String(SOURCE_YEAR) }) },
      );
      expect(first.status).toBe(200);

      const replay = await roster.DELETE(
        jsonRequest(`/api/admin/academic-years/${SOURCE_YEAR}/roster`, "DELETE", {
          requestId,
          expectedVersion: control.version,
          entryIds: [b, a],
        }),
        { params: Promise.resolve({ year: String(SOURCE_YEAR) }) },
      );
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(await first.json());

      const differentSelection = await roster.DELETE(
        jsonRequest(`/api/admin/academic-years/${SOURCE_YEAR}/roster`, "DELETE", {
          requestId,
          expectedVersion: control.version,
          entryIds: [a],
        }),
        { params: Promise.resolve({ year: String(SOURCE_YEAR) }) },
      );
      expect(differentSelection.status).toBe(409);
      expect((await differentSelection.json()).error.code).toBe("REQUEST_REUSED");
    });
  });

  describe("records/[userId] route: ARCHIVED correction vs ACTIVE upsert", () => {
    async function subadminSession() {
      const teacher = await db.user.update({
        where: { id: fx.teacherId },
        data: { adminLevel: "SUBADMIN" },
      });
      return {
        user: {
          dbUserId: teacher.id,
          role: "TEACHER",
          adminLevel: "SUBADMIN",
          sessionVersion: teacher.sessionVersion,
        },
      };
    }

    it("ARCHIVED 연도는 항목이 지워졌어도 correctAcademicRecord로 정정되고 항목을 만들지 않는다", async () => {
      await archiveSourceYear();
      await deleteArchivedRoster(db, {
        actor: fx.main,
        requestId: "route-delete-before-correct",
        expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "route-delete-before-correct",
        year: SOURCE_YEAR,
        entryIds: "ALL",
      });

      const records = await import("@/app/api/admin/academic-years/[year]/records/[userId]/route");
      const requestId = randomUUID();
      const res = await records.PUT(
        jsonRequest(`/api/admin/academic-years/${SOURCE_YEAR}/records/${fx.studentId}`, "PUT", {
          requestId,
          expectedRowVersion: await recordVersion(fx.studentId),
          email: "student-test@example.posan.kr",
          profile: studentProfile({ name: "라우트정정" }),
        }),
        { params: Promise.resolve({ year: String(SOURCE_YEAR), userId: String(fx.studentId) }) },
      );

      expect(res.status).toBe(200);
      const corrected = (await getAcademicProfiles(db, [fx.studentId], SOURCE_YEAR)).get(fx.studentId);
      expect(corrected?.name).toBe("라우트정정");
      expect(await db.rosterEntry.count({ where: { year: SOURCE_YEAR } })).toBe(0);

      const stored = await db.rosterMutation.findUniqueOrThrow({ where: { requestId } });
      expect(stored.kind).toBe("ROSTER_CORRECT");
    });

    it("ACTIVE 연도는 그대로 upsertRosterProfile(ROSTER_ROW) 경로로 간다", async () => {
      const records = await import("@/app/api/admin/academic-years/[year]/records/[userId]/route");
      const requestId = randomUUID();
      const res = await records.PUT(
        jsonRequest(`/api/admin/academic-years/${SOURCE_YEAR}/records/${fx.studentId}`, "PUT", {
          requestId,
          expectedRowVersion: await recordVersion(fx.studentId),
          email: "student-test@example.posan.kr",
          profile: studentProfile({ name: "활성연도정정" }),
        }),
        { params: Promise.resolve({ year: String(SOURCE_YEAR), userId: String(fx.studentId) }) },
      );

      expect(res.status).toBe(200);
      const stored = await db.rosterMutation.findUniqueOrThrow({ where: { requestId } });
      expect(stored.kind).toBe("ROSTER_ROW");
      expect((await db.userAcademicRecord.findUniqueOrThrow({
        where: { year_userId: { year: SOURCE_YEAR, userId: fx.studentId } },
      })).name).toBe("활성연도정정");
    });

    it("READ_ADMIN은 ARCHIVED 정정도 403이다", async () => {
      await archiveSourceYear();
      await deleteArchivedRoster(db, {
        actor: fx.main,
        requestId: "route-delete-before-readonly",
        expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
        kind: "ARCHIVE_DELETE",
        payloadHash: "route-delete-before-readonly",
        year: SOURCE_YEAR,
        entryIds: "ALL",
      });

      mocks.auth.mockResolvedValue(await subadminSession());

      const records = await import("@/app/api/admin/academic-years/[year]/records/[userId]/route");
      const res = await records.PUT(
        jsonRequest(`/api/admin/academic-years/${SOURCE_YEAR}/records/${fx.studentId}`, "PUT", {
          requestId: randomUUID(),
          expectedRowVersion: await recordVersion(fx.studentId),
          email: "student-test@example.posan.kr",
          profile: studentProfile({ name: "권한없음" }),
        }),
        { params: Promise.resolve({ year: String(SOURCE_YEAR), userId: String(fx.studentId) }) },
      );

      expect(res.status).toBe(403);
    });
  });

  describe("backfill2026 재실행의 활성 학년도 확인", () => {
    it("이미 COPIED된 뒤 활성 학년도가 하나도 없으면 여전히 거절한다", async () => {
      const before = await captureLegacyFingerprint(pgClient);
      await backfill2026(db, before);

      await db.academicYear.updateMany({ data: { state: "ARCHIVED" } });

      await expect(backfill2026(db, before)).rejects.toBeInstanceOf(DomainError);
      await expect(backfill2026(db, before)).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
    });

    it("전환 뒤(활성 연도가 2027)에도 이미 COPIED면 재실행은 계속 no-op이다", async () => {
      const before = await captureLegacyFingerprint(pgClient);
      await backfill2026(db, before);

      await archiveSourceYear();

      const result = await backfill2026(db, before);
      expect(result.inserted).toBe(0);
    });
  });
});
