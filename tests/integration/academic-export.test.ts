import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import { isDomainError } from "@/lib/academic-year/errors";
import { exportRoster } from "@/lib/academic-year/export-service";
import { createDraftYear, upsertRosterProfile } from "@/lib/academic-year/roster-service";
import { parseRosterWorkbook } from "@/lib/academic-year/workbook-parser";
import {
  openAcademicTestDb,
  openAcademicTestPgClient,
  resetAcademicTestDb,
} from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const YEAR = 2026;
const NEXT_YEAR = 2027;

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

const MAIN_SESSION = { user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } };

async function toParsed(buffer: Buffer) {
  return parseRosterWorkbook(Uint8Array.from(buffer).buffer);
}

async function expectDomainCode(run: Promise<unknown>, code: string): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(isDomainError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`${code} 로 거절되어야 하는 호출이 성공했습니다.`);
}

describe("exportRoster", () => {
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

  it("템플릿만(includeData=false) 받으면 RosterFile 행을 만들지 않는다", async () => {
    const before = await db.rosterFile.count();
    const buffer = await exportRoster(db, fx.main, YEAR, false, false);
    const after = await db.rosterFile.count();

    expect(after).toBe(before);

    const parsed = await toParsed(buffer);
    expect(parsed.templateOnly).toBe(true);
    expect(parsed.rows).toEqual([]);
  });

  it("데이터 포함 다운로드는 RosterFile을 정확히 1개 만들고 행별 버전이 일치한다", async () => {
    const buffer = await exportRoster(db, fx.main, YEAR, true, false);
    const files = await db.rosterFile.findMany({ where: { year: YEAR } });
    expect(files).toHaveLength(1);

    const manifest = files[0]!.manifest as {
      rows: Record<string, { entryId: string; userId: number | null; email: string; version: number }>;
    };
    const parsed = await toParsed(buffer);
    expect(parsed.templateOnly).toBe(false);
    expect(parsed.fileId).toBe(files[0]!.id);

    for (const row of parsed.rows) {
      expect(row.rowToken).toBeDefined();
      const manifestRow = manifest.rows[row.rowToken!];
      expect(manifestRow).toBeDefined();
      expect(manifestRow!.email).toBe(row.email);

      const record = await db.userAcademicRecord.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: manifestRow!.userId! } },
      });
      expect(manifestRow!.version).toBe(record.version);
    }
  });

  it("보존 정리로 RosterEntry가 지워진 지난 학년도는 데이터 행을 내보내지 않는다", async () => {
    const pastYear = 2025;
    await db.academicYear.create({ data: { year: pastYear, state: "ARCHIVED", version: 0 } });
    await db.userAcademicRecord.create({
      data: {
        year: pastYear,
        userId: fx.studentId,
        role: "STUDENT",
        name: "학생하나",
        grade: 3,
        classNum: 1,
        number: 1,
        gender: "MALE",
        memberState: "GRADUATED",
        version: 0,
      },
    });
    // RosterEntry가 아예 없다 — 보존 정리로 지워졌다고 가정.

    const buffer = await exportRoster(db, fx.main, pastYear, true, false);
    const parsed = await toParsed(buffer);
    expect(parsed.rows).toEqual([]);

    const files = await db.rosterFile.findMany({ where: { year: pastYear } });
    expect(files).toHaveLength(1);
    const manifest = files[0]!.manifest as { rows: Record<string, unknown> };
    expect(Object.keys(manifest.rows)).toEqual([]);
  });

  it("includeCurrent는 현재(ACTIVE) 학년도 기록이 없는 사용자는 참고 열을 비운다", async () => {
    // 졸업생: 2026년(ACTIVE) 기록이 아예 없다.
    const graduate = await db.user.create({
      data: {
        email: "graduate-test@example.posan.kr",
        name: "졸업생하나",
        role: "STUDENT",
        accessState: "ACTIVE",
      },
    });

    const pastYear = 2025;
    await db.academicYear.create({ data: { year: pastYear, state: "ARCHIVED", version: 0 } });
    await db.rosterEntry.create({
      data: {
        year: pastYear,
        userId: graduate.id,
        emailKey: "graduate-test@example.posan.kr",
        included: true,
        version: 0,
      },
    });
    await db.userAcademicRecord.create({
      data: {
        year: pastYear,
        userId: graduate.id,
        role: "STUDENT",
        name: "졸업생하나",
        grade: 3,
        classNum: 1,
        number: 1,
        gender: "MALE",
        memberState: "GRADUATED",
        version: 0,
      },
    });

    const buffer = await exportRoster(db, fx.main, pastYear, true, true);
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    const headerValues = sheet.getRow(1).values as unknown[];
    const gradeIdx = headerValues.findIndex((v) => v === "참고_현재학년");
    expect(gradeIdx).toBeGreaterThan(0);
    // 2026년 UserAcademicRecord가 없으므로(ACTIVE 학년도 기록 없음) 참고 열은 빈칸이어야 한다.
    expect(sheet.getRow(2).getCell(gradeIdx).value).toBeNull();
  });

  it("학생 계정은 명부 다운로드가 403이다", async () => {
    const studentActor: Actor = { kind: "USER", userId: fx.studentId, sessionVersion: 0 };
    await expectDomainCode(exportRoster(db, studentActor, YEAR, true, false), "FORBIDDEN");
  });

  it("PREPARING 상태에서는 503으로 막힌다", async () => {
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
    await expectDomainCode(exportRoster(db, fx.main, YEAR, true, false), "NOT_READY");
  });

  it("초안 학년도를 내보내면 아직 User가 없는 신규 행도 entryId·version이 일치한다", async () => {
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "export-draft",
      expectedVersion: fx.version,
      kind: "DRAFT",
      payloadHash: "export-draft",
      year: NEXT_YEAR,
    });

    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    await upsertRosterProfile(db, {
      actor: fx.main,
      requestId: "draft-new-row",
      expectedRowVersion: 0,
      expectedVersion: control.version,
      kind: "ROSTER_ROW",
      payloadHash: "draft-new-row",
      year: NEXT_YEAR,
      email: "draft.new@example.posan.kr",
      profile: { role: "STUDENT", name: "초안신입", grade: 2, classNum: 5, number: 9, gender: "MALE", subject: null, homeroom: null, position: null },
    });

    const entry = await db.rosterEntry.findFirstOrThrow({
      where: { year: NEXT_YEAR, emailKey: "draft.new@example.posan.kr" },
    });
    expect(entry.userId).toBeNull();

    const buffer = await exportRoster(db, fx.main, NEXT_YEAR, true, false);
    const files = await db.rosterFile.findMany({ where: { year: NEXT_YEAR } });
    expect(files).toHaveLength(1);
    const manifest = files[0]!.manifest as {
      rows: Record<string, { entryId: string; userId: number | null; email: string; version: number }>;
    };

    const parsed = await toParsed(buffer);
    const draftRow = parsed.rows.find((r) => r.email === "draft.new@example.posan.kr")!;
    expect(draftRow).toBeDefined();
    const manifestRow = manifest.rows[draftRow.rowToken!]!;
    expect(manifestRow.entryId).toBe(entry.id);
    expect(manifestRow.userId).toBeNull();
    expect(manifestRow.version).toBe(entry.version);
  });

  describe("GET /api/admin/academic-years/[year]/template", () => {
    async function callRoute(url: string) {
      const { GET } = await import("@/app/api/admin/academic-years/[year]/template/route");
      const match = url.match(/academic-years\/([^/?]+)\/template/);
      const year = match![1]!;
      return GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ year }) });
    }

    it("잘못된 학년도 경로 값은 422다", async () => {
      const res = await callRoute("/api/admin/academic-years/not-a-year/template");
      expect(res.status).toBe(422);
    });

    it("잘못된 includeData 값은 422다", async () => {
      const res = await callRoute(`/api/admin/academic-years/${YEAR}/template?includeData=yes`);
      expect(res.status).toBe(422);
    });

    it("정상 요청은 xlsx를 내려준다", async () => {
      const res = await callRoute(`/api/admin/academic-years/${YEAR}/template?includeData=1`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    });
  });
});
