import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { correctAcademicRecord, deleteArchivedRoster } from "@/lib/academic-year/archive-service";
import { getAcademicProfiles } from "@/lib/academic-year/profile-service";
import { activateAcademicYear, reviewRollover } from "@/lib/academic-year/rollover-service";
import { backfill2026 } from "@/lib/academic-year/backfill";
import { createDraftYear, listRoster, upsertRosterProfile } from "@/lib/academic-year/roster-service";
import { captureLegacyFingerprint, compareLegacyFingerprints } from "../../scripts/academic-year/fingerprint";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const TODAY = "2026-09-18";
const SOURCE_YEAR = 2026;
const TARGET_YEAR = 2027;

describe("academic archive", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
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

  it("물리 명부를 지워도 표시 기록은 남고 재실행은 아무것도 만들지 않는다", async () => {
    const version = await archiveSourceYear();
    const original = await captureLegacyFingerprint(pgClient);

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
    expect((await getAcademicProfiles(db, [fx.studentId], SOURCE_YEAR)).get(fx.studentId)?.grade).toBe(1);

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

  it("PREPARING 동안은 차단된다", async () => {
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

  it("삭제는 Record·User·신청·체크인·안면 프로필 건수를 바꾸지 않는다", async () => {
    const version = await archiveSourceYear();

    const before = {
      records: await db.userAcademicRecord.count(),
      users: await db.user.count(),
      registrations: await db.mealRegistration.count(),
      checkIns: await db.checkIn.count(),
      faceProfiles: await db.faceProfile.count(),
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
    const version = await archiveSourceYear();

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-before-correct",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-before-correct",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    const before = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    const currentYearRecord = await db.userAcademicRecord.findUnique({
      where: { year_userId: { year: TARGET_YEAR, userId: fx.studentId } },
    });

    const receipt = await correctAcademicRecord(db, {
      actor: fx.main,
      requestId: "correct-2026",
      expectedVersion: control.version,
      kind: "ROSTER_CORRECT",
      payloadHash: "correct-2026",
      year: SOURCE_YEAR,
      userId: fx.studentId,
      profile: {
        role: "STUDENT",
        name: "정정된이름",
        grade: 1,
        classNum: 1,
        number: 1,
        gender: "MALE",
        subject: null,
        homeroom: null,
        position: null,
      },
    });
    expect(receipt.changed).toBeGreaterThan(0);

    const corrected = (await getAcademicProfiles(db, [fx.studentId], SOURCE_YEAR)).get(fx.studentId);
    expect(corrected?.name).toBe("정정된이름");

    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);

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
        expectedVersion: fx.version,
        kind: "ROSTER_CORRECT",
        payloadHash: "correct-active",
        year: SOURCE_YEAR,
        userId: fx.studentId,
        profile: {
          role: "STUDENT",
          name: "고쳐본이름",
          grade: 1,
          classNum: 1,
          number: 1,
          gender: "MALE",
          subject: null,
          homeroom: null,
          position: null,
        },
      }),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
  });

  it("교사 관리자(WRITE_ADMIN)는 정정할 수 있고, 일반 명부 export는 정정만으로 명부를 되살리지 않는다", async () => {
    const version = await archiveSourceYear();

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-before-writer-correct",
      expectedVersion: version,
      kind: "ARCHIVE_DELETE",
      payloadHash: "delete-before-writer-correct",
      year: SOURCE_YEAR,
      entryIds: "ALL",
    });

    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    await correctAcademicRecord(db, {
      actor: fx.writer,
      requestId: "correct-by-writer",
      expectedVersion: control.version,
      kind: "ROSTER_CORRECT",
      payloadHash: "correct-by-writer",
      year: SOURCE_YEAR,
      userId: fx.studentId,
      profile: {
        role: "STUDENT",
        name: "다시정정",
        grade: 1,
        classNum: 1,
        number: 1,
        gender: "MALE",
        subject: null,
        homeroom: null,
        position: null,
      },
    });

    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);
  });

  it("upsertRosterProfile로도 지워진 보관 연도 항목을 다시 만들지 않고 기록만 고친다", async () => {
    const version = await archiveSourceYear();

    await deleteArchivedRoster(db, {
      actor: fx.main,
      requestId: "delete-before-upsert",
      expectedVersion: version,
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
      profile: {
        role: "STUDENT",
        name: "명부없이정정",
        grade: 1,
        classNum: 1,
        number: 1,
        gender: "MALE",
        subject: null,
        homeroom: null,
        position: null,
      },
    });

    expect(await listRoster(db, SOURCE_YEAR)).toEqual([]);
    const corrected = (await getAcademicProfiles(db, [fx.studentId], SOURCE_YEAR)).get(fx.studentId);
    expect(corrected?.name).toBe("명부없이정정");
  });
});
