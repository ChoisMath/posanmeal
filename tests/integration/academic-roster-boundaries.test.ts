import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Tx } from "@/lib/academic-year/db";
import { captureLegacyFingerprint } from "../../scripts/academic-year/fingerprint";
import { exportRoster } from "@/lib/academic-year/export-service";
import { commitRosterImport, previewRosterImport } from "@/lib/academic-year/import-service";
import { activateAcademicYear, reviewRollover } from "@/lib/academic-year/rollover-service";
import { createDraftYear, listRosterView, upsertRosterProfile } from "@/lib/academic-year/roster-service";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";
import type { Client } from "pg";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function pauseDraftRows(db: PrismaClient) {
  const loaded = gate();
  const resume = gate();
  let paused = false;
  const wrap = <T extends PrismaClient | Tx>(client: T): T => new Proxy(client, {
    get(target, key) {
      const original = Reflect.get(target, key, target);
      if (key === "$transaction" && typeof original === "function") {
        return (work: (tx: Tx) => Promise<unknown>, options: unknown) =>
          Reflect.apply(original, target, [(tx: Tx) => work(wrap(tx)), options]);
      }
      if (key === "$queryRawUnsafe" && typeof original === "function") {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(original, target, args);
          if (!paused && String(args[0]).includes('e."draftProfile"')) {
            paused = true;
            loaded.release();
            await resume.promise;
          }
          return result;
        };
      }
      return typeof original === "function" ? original.bind(target) : original;
    },
  });
  return { client: wrap(db), loaded: loaded.promise, release: resume.release };
}

describe("roster target and preview boundaries", () => {
  let db: PrismaClient;
  let pg: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pg = await openAcademicTestPgClient();
  });
  afterAll(async () => { await pg.end(); await db.$disconnect(); });
  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pg);
  });

  async function draft(sourceYear = 2026) {
    await createDraftYear(db, {
      actor: fx.main, requestId: "boundary-draft", kind: "DRAFT", payloadHash: "draft",
      expectedVersion: fx.version, year: 2027, sourceYear,
    });
  }

  it("DRAFT 요청의 다른 연도 entryId는 원본과 영수증을 남기지 않고 거절한다", async () => {
    await db.academicYear.create({ data: { year: 2025, state: "ARCHIVED" } });
    await draft(2025);
    const row = (await listRosterView(db, 2026, "STUDENT"))[0];
    const before = await db.rosterEntry.findUniqueOrThrow({ where: { id: row.entryId } });
    const original = await captureLegacyFingerprint(pg);

    await expect(upsertRosterProfile(db, {
      actor: fx.main, requestId: "wrong-entry-year", kind: "ROSTER_ROW", payloadHash: "wrong-year",
      expectedRowVersion: before.version, year: 2027, userId: fx.studentId,
      entryId: row.entryId, email: row.email, profile: { ...row.profile, name: "초안인줄알고수정" },
    })).rejects.toMatchObject({ code: "YEAR_MISMATCH" });

    expect(await db.rosterEntry.findUniqueOrThrow({ where: { id: row.entryId } })).toEqual(before);
    expect(await db.rosterMutation.count({ where: { requestId: "wrong-entry-year" } })).toBe(0);
    expect(await captureLegacyFingerprint(pg)).toEqual(original);
  });

  it("DRAFT의 기존 entryId와 다른 userId를 조합해 연결 대상을 바꿀 수 없다", async () => {
    await draft();
    const row = (await listRosterView(db, 2027, "STUDENT"))[0];
    const other = await db.user.create({ data: {
      email: "other-target@example.posan.kr", emailKey: "other-target@example.posan.kr",
      role: "STUDENT", name: "다른학생", grade: 2, classNum: 1, number: 2, gender: "MALE",
    } });
    const before = await db.rosterEntry.findUniqueOrThrow({ where: { id: row.entryId } });

    await expect(upsertRosterProfile(db, {
      actor: fx.main, requestId: "wrong-entry-user", kind: "ROSTER_ROW", payloadHash: "wrong-user",
      expectedRowVersion: row.version, year: 2027, userId: other.id,
      entryId: row.entryId, email: other.email, profile: { ...row.profile, name: other.name },
    })).rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });

    expect(await db.rosterEntry.findUniqueOrThrow({ where: { id: row.entryId } })).toEqual(before);
    expect(await db.rosterMutation.count({ where: { requestId: "wrong-entry-user" } })).toBe(0);
  });

  it.each(["ACTIVE", "DRAFT"] as const)("%s 명부에서 학생 계정을 교사 종류로 바꿀 수 없다", async (state) => {
    if (state === "DRAFT") await draft();
    const year = state === "DRAFT" ? 2027 : 2026;
    const row = (await listRosterView(db, year, "STUDENT"))[0];
    const teacher = (await listRosterView(db, 2026, "TEACHER"))[0];
    const beforeEntry = await db.rosterEntry.findUniqueOrThrow({ where: { id: row.entryId } });
    const beforeRecord = await db.userAcademicRecord.findUnique({ where: { year_userId: { userId: fx.studentId, year } } });
    const original = await captureLegacyFingerprint(pg);
    const requestId = `change-account-role-${state}`;

    await expect(upsertRosterProfile(db, {
      actor: fx.main, requestId, kind: "ROSTER_ROW", payloadHash: "change-role",
      expectedRowVersion: row.version, year, userId: fx.studentId,
      entryId: row.entryId, email: row.email, profile: { ...teacher.profile, name: row.profile.name },
    })).rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });

    expect(await db.rosterEntry.findUniqueOrThrow({ where: { id: row.entryId } })).toEqual(beforeEntry);
    expect(await db.userAcademicRecord.findUnique({ where: { year_userId: { userId: fx.studentId, year } } })).toEqual(beforeRecord);
    expect(await captureLegacyFingerprint(pg)).toEqual(original);
    expect(await db.rosterMutation.count({ where: { requestId } })).toBe(0);
  });

  it("DRAFT 행을 읽는 동안 전환되어도 새 control 버전으로 옛 미리보기를 확정할 수 없다", async () => {
    await draft();
    const review = await reviewRollover(db, fx.main, 2027, { today: "2027-03-01" });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(await exportRoster(db, fx.main, 2027, true, false)).buffer);
    book.getWorksheet("학생")!.getCell("E2").value = "파일초안수정";
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const paused = pauseDraftRows(db);
    const previewing = previewRosterImport(paused.client, fx.main, 2027, "PARTIAL", bytes);
    await paused.loaded;
    try {
      await activateAcademicYear(db, {
        actor: fx.main, requestId: "activate-during-preview", kind: "ACTIVATE_YEAR", payloadHash: "activate",
        expectedVersion: review.version, year: 2027, yearVersion: review.yearVersion,
        sourceVersion: review.sourceVersion, kiosksPaused: true, warningsAcknowledged: true,
        today: "2027-03-01",
      });
    } finally {
      paused.release();
    }
    const preview = await previewing;
    const original = await captureLegacyFingerprint(pg);
    await expect(commitRosterImport(db, {
      actor: fx.main, requestId: "commit-old-draft", kind: "ROSTER_IMPORT", payloadHash: "commit",
      expectedVersion: preview.controlVersion, year: 2027, importId: preview.id,
      confirmedNewRowTokens: [], omissionsConfirmed: false,
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    expect(preview.controlVersion).toBe(review.version);
    expect(await captureLegacyFingerprint(pg)).toEqual(original);
    expect(await db.rosterMutation.count({ where: { requestId: "commit-old-draft" } })).toBe(0);
  });
});
