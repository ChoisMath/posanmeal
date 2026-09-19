import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { ImportPreview, RosterRow } from "@/lib/academic-year/contracts";
import { isDomainError } from "@/lib/academic-year/errors";
import { exportRoster } from "@/lib/academic-year/export-service";
import {
  cancelRosterImport,
  commitRosterImport,
  previewRosterImport,
  resolveImportConflicts,
} from "@/lib/academic-year/import-service";
import { purgeExpiredRosterCopies } from "@/lib/academic-year/retention";
import { createDraftYear, writeRosterProfiles } from "@/lib/academic-year/roster-service";
import { captureLegacyFingerprint } from "../../scripts/academic-year/fingerprint";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
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

/** 학생 시트: A 이메일 · B 학년 · C 반 · D 번호 · E 이름 · F 성별 · G __rowToken */
const STUDENT_NAME_CELL = "E";
const STUDENT_NUMBER_CELL = "D";
const STUDENT_TOKEN_CELL = "G";
/** 교사 시트: A 이메일 · B 과목 · C 담임 · D 직책 · E 이름 · F __rowToken */
const TEACHER_SUBJECT_CELL = "B";
const TEACHER_NAME_CELL = "E";

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

async function loadBook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Uint8Array.from(buffer).buffer);
  return book;
}

async function toBytes(book: ExcelJS.Workbook): Promise<ArrayBuffer> {
  // ExcelJS의 writeBuffer는 ArrayBuffer 호환 값을 돌려준다.
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("명부 파일 미리보기·확정", () => {
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

  /** 내보낸 뒤 학생 이름만 고친 파일. 대부분의 테스트가 이 파일에서 시작한다. */
  async function renamedStudentFile(): Promise<ArrayBuffer> {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("학생")!.getCell(`${STUDENT_NAME_CELL}2`).value = "수정이름";
    return toBytes(book);
  }

  async function controlVersion(): Promise<number> {
    return (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version;
  }

  /** 교사 시트가 "데이터 있는 시트"로 남도록 두 번째 교사를 둔다. */
  async function addTeacher(email: string, name: string): Promise<number> {
    await db.$transaction((tx) =>
      writeRosterProfiles(tx, YEAR, [
        {
          entryId: crypto.randomUUID(),
          userId: null,
          email,
          emailKey: email,
          profile: {
            role: "TEACHER",
            name,
            grade: null,
            classNum: null,
            number: null,
            gender: null,
            subject: "국어",
            homeroom: null,
            position: null,
          },
          baseUserVersion: null,
          included: true,
        },
      ]),
    );
    return (await db.user.findFirstOrThrow({ where: { email } })).id;
  }

  function removeRowByEmail(sheet: ExcelJS.Worksheet, email: string): void {
    for (let r = 2; r <= sheet.actualRowCount; r++) {
      if (String(sheet.getCell(`A${r}`).value) === email) {
        sheet.spliceRows(r, 1);
        return;
      }
    }
    throw new Error(`시트에서 ${email} 행을 찾지 못했습니다.`);
  }

  function commitInput(preview: ImportPreview, requestId: string, extra?: Partial<{
    confirmedNewRowTokens: string[];
    omissionsConfirmed: boolean;
    expectedVersion: number;
    payloadHash: string;
    year: number;
  }>) {
    return {
      actor: fx.main,
      requestId,
      kind: "IMPORT",
      expectedVersion: extra?.expectedVersion ?? preview.controlVersion,
      payloadHash: extra?.payloadHash ?? "input-hash",
      year: extra?.year ?? preview.year,
      importId: preview.id,
      confirmedNewRowTokens: extra?.confirmedNewRowTokens ?? [],
      omissionsConfirmed: extra?.omissionsConfirmed ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // 미리보기 이후의 변경 / 미리보기 이전의 변경
  // -------------------------------------------------------------------------

  it("미리보기 이후 서버가 바뀌면 VERSION_CONFLICT로 물리고 아무것도 쓰지 않는다", async () => {
    const workbookBytes = await renamedStudentFile();
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", workbookBytes);
    expect(preview.rows.map((r) => r.kind)).toContain("CHANGED");

    await db.user.update({ where: { id: fx.teacherId }, data: { profileVersion: { increment: 1 } } });

    await expectDomainCode(
      commitRosterImport(db, commitInput(preview, "import-1")),
      "VERSION_CONFLICT",
    );

    expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).name).toBe("학생테스트");
    expect(await db.rosterMutation.count()).toBe(1); // fixture의 학년도 기능 활성화 1건뿐
  });

  it("미리보기 이후 다른 행의 학년도 기록이 바뀌어도 VERSION_CONFLICT다", async () => {
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());

    await db.userAcademicRecord.update({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
      data: { subject: "나중에 바뀐 과목", version: { increment: 1 } },
    });

    await expectDomainCode(
      commitRosterImport(db, commitInput(preview, "import-row-drift")),
      "VERSION_CONFLICT",
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).name).toBe("학생테스트");
  });

  it("내보낸 뒤·미리보기 전의 변경은 그 행만 CONFLICT로 다루고 KEEP_SERVER는 서버 값을 지킨다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("학생")!.getCell(`${STUDENT_NAME_CELL}2`).value = "수정이름";
    book.getWorksheet("교사")!.getCell(`${TEACHER_SUBJECT_CELL}2`).value = "파일과목";
    const workbookBytes = await toBytes(book);

    await db.userAcademicRecord.update({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
      data: { subject: "서버에서 정정", version: { increment: 1 } },
    });

    const conflicted = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", workbookBytes);
    expect(conflicted.rows.filter((r) => r.kind === "CONFLICT")).toHaveLength(1);
    expect(conflicted.rows.some((r) => r.kind === "CHANGED")).toBe(true);
    expect(conflicted.canCommit).toBe(false);

    const conflictRow = conflicted.rows.find((r) => r.kind === "CONFLICT")!;
    expect(conflictRow.server?.subject).toBe("서버에서 정정");

    const resolved = await resolveImportConflicts(db, fx.main, YEAR, conflicted.id, [
      { token: conflictRow.token, resolution: "KEEP_SERVER" },
    ]);
    expect(resolved.canCommit).toBe(true);

    await commitRosterImport(db, commitInput(resolved, "import-keep", { expectedVersion: await controlVersion() }));

    const teacherRecord = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
    });
    expect(teacherRecord.subject).toBe("서버에서 정정");
    expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).name).toBe("수정이름");
  });

  it("확정은 payload·preview를 비우고 건수만 남긴다", async () => {
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());
    await commitRosterImport(db, commitInput(preview, "import-commit"));

    const row = await db.rosterImport.findUniqueOrThrow({ where: { id: preview.id } });
    expect(row.state).toBe("COMMITTED");
    expect(row.payload).toBeNull();
    expect(row.preview).toBeNull();
    expect(row.summary).toMatchObject({ year: YEAR, changed: expect.any(Number) });
  });

  // -------------------------------------------------------------------------
  // 원자성
  // -------------------------------------------------------------------------

  it("반영 도중 실제 unique 실패가 나면 학생·교사·RosterMutation 모두 되돌린다", async () => {
    // 교사의 명부 항목을 지우고 같은 emailKey를 쥔 짝 없는 항목을 심어 둔다.
    // 확정은 기록·User를 먼저 쓴 뒤 항목 upsert에서 (year, emailKey) unique에 걸린다.
    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    await db.rosterEntry.deleteMany({ where: { year: YEAR, userId: fx.teacherId } });
    await db.rosterEntry.create({
      data: { year: YEAR, userId: null, emailKey: teacher.emailKey!, included: true },
    });

    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("학생")!.getCell(`${STUDENT_NAME_CELL}2`).value = "수정이름";
    book.getWorksheet("교사")!.getCell(`${TEACHER_NAME_CELL}2`).value = "교사수정";
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));

    const before = await captureLegacyFingerprint(pgClient);
    const mutationsBefore = await db.rosterMutation.count();

    await expectDomainCode(
      commitRosterImport(db, commitInput(preview, "import-rollback")),
      "IDENTITY_CONFLICT",
    );

    const after = await captureLegacyFingerprint(pgClient);
    expect(after).toEqual(before);
    expect(await db.rosterMutation.count()).toBe(mutationsBefore);
    expect(await db.rosterMutation.findUnique({ where: { requestId: "import-rollback" } })).toBeNull();
    expect((await db.rosterImport.findUniqueOrThrow({ where: { id: preview.id } })).state).toBe("PREVIEW");
  });

  it("두 학생이 번호를 맞바꾸면 최종 상태가 유일하므로 성공한다", async () => {
    const other = await db.$transaction((tx) =>
      writeRosterProfiles(tx, YEAR, [
        {
          entryId: crypto.randomUUID(),
          userId: null,
          email: "student-two@example.posan.kr",
          emailKey: "student-two@example.posan.kr",
          profile: {
            role: "STUDENT",
            name: "학생둘",
            grade: 1,
            classNum: 1,
            number: 2,
            gender: "FEMALE",
            subject: null,
            homeroom: null,
            position: null,
          },
          baseUserVersion: null,
          included: true,
        },
      ]),
    );
    expect(other.changed).toBe(1);

    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    const sheet = book.getWorksheet("학생")!;
    const emailOf = (row: number) => String(sheet.getCell(`A${row}`).value);
    for (const row of [2, 3]) {
      sheet.getCell(`${STUDENT_NUMBER_CELL}${row}`).value =
        emailOf(row) === "student-test@example.posan.kr" ? 2 : 1;
    }

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    expect(preview.canCommit).toBe(true);
    await commitRosterImport(db, commitInput(preview, "import-swap"));

    const records = await db.userAcademicRecord.findMany({
      where: { year: YEAR, role: "STUDENT" },
      select: { userId: true, number: true },
      orderBy: { userId: "asc" },
    });
    expect(records.find((r) => r.userId === fx.studentId)!.number).toBe(2);
    expect(records.find((r) => r.userId !== fx.studentId)!.number).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 재전송·동시 요청
  // -------------------------------------------------------------------------

  it("같은 요청키 재전송은 같은 수령증을, 다른 입력은 REQUEST_REUSED를 준다", async () => {
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());
    const first = await commitRosterImport(db, commitInput(preview, "import-replay"));
    const again = await commitRosterImport(db, commitInput(preview, "import-replay"));
    expect(again).toEqual(first);

    await expectDomainCode(
      commitRosterImport(db, commitInput(preview, "import-replay", { payloadHash: "다른-입력" })),
      "REQUEST_REUSED",
    );
  });

  it("두 관리자가 각자 미리보기를 만들면 한쪽만 확정된다", async () => {
    const bytes = await renamedStudentFile();
    const a = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", bytes);
    const b = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", bytes);

    await commitRosterImport(db, commitInput(a, "import-a"));
    await expectDomainCode(commitRosterImport(db, commitInput(b, "import-b")), "VERSION_CONFLICT");
  });

  // -------------------------------------------------------------------------
  // 신규 행
  // -------------------------------------------------------------------------

  it("신규 행은 확인 토큰 없이는 확정되지 않고, 확인하면 계정을 만든다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    const sheet = book.getWorksheet("학생")!;
    sheet.getCell("A3").value = "new-student@example.posan.kr";
    sheet.getCell("B3").value = 2;
    sheet.getCell("C3").value = 3;
    sheet.getCell("D3").value = 4;
    sheet.getCell(`${STUDENT_NAME_CELL}3`).value = "신입생";
    sheet.getCell("F3").value = "여";

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    const newRow = preview.rows.find((r) => r.kind === "NEW");
    expect(newRow).toBeDefined();
    expect(preview.canCommit).toBe(true);

    await expectDomainCode(commitRosterImport(db, commitInput(preview, "import-new-1")), "REVIEW_REQUIRED");
    expect(await db.user.count({ where: { email: "new-student@example.posan.kr" } })).toBe(0);

    await commitRosterImport(
      db,
      commitInput(preview, "import-new-2", { confirmedNewRowTokens: [newRow!.token] }),
    );

    const created = await db.user.findFirstOrThrow({ where: { email: "new-student@example.posan.kr" } });
    expect(created.name).toBe("신입생");
    expect(await db.userAccessEvent.count({ where: { userId: created.id, reason: "ROSTER_ADD" } })).toBe(1);
  });

  it("이용 중지 계정·다른 역할 계정의 이메일은 REVIEW로 막는다", async () => {
    await db.user.create({
      data: {
        email: "stopped@example.posan.kr",
        emailKey: "stopped@example.posan.kr",
        name: "중지계정",
        role: "STUDENT",
        accessState: "INACTIVE",
      },
    });

    await db.user.create({
      data: {
        email: "outside-teacher@example.posan.kr",
        emailKey: "outside-teacher@example.posan.kr",
        name: "명부밖교사",
        role: "TEACHER",
      },
    });

    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    const students = book.getWorksheet("학생")!;
    students.getCell("A3").value = "stopped@example.posan.kr";
    students.getCell("B3").value = 2;
    students.getCell("C3").value = 1;
    students.getCell("D3").value = 7;
    students.getCell(`${STUDENT_NAME_CELL}3`).value = "중지계정";
    students.getCell("F3").value = "남";
    // 명부에는 없지만 교사 계정이 쥐고 있는 이메일을 학생 시트에 넣으면 역할이 어긋난다.
    students.getCell("A4").value = "outside-teacher@example.posan.kr";
    students.getCell("B4").value = 2;
    students.getCell("C4").value = 1;
    students.getCell("D4").value = 8;
    students.getCell(`${STUDENT_NAME_CELL}4`).value = "교사테스트";
    students.getCell("F4").value = "남";

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    const codes = preview.rows.flatMap((r) => r.issues.map((i) => i.code));
    expect(codes).toContain("ACCOUNT_INACTIVE");
    expect(codes).toContain("ROLE_MISMATCH");
    expect(preview.canCommit).toBe(false);
    await expectDomainCode(commitRosterImport(db, commitInput(preview, "import-blocked")), "REVIEW_REQUIRED");
  });

  // -------------------------------------------------------------------------
  // 파일 신뢰성
  // -------------------------------------------------------------------------

  it("행 토큰의 원래 이메일이 바뀐 행은 이메일 변경 절차를 안내한다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("학생")!.getCell("A2").value = "moved@example.posan.kr";

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    const issue = preview.rows.flatMap((r) => r.issues).find((i) => i.code === "IDENTITY_CONFLICT");
    expect(issue?.message).toContain("이메일 변경");
    expect(preview.canCommit).toBe(false);
  });

  it("데이터가 담긴 파일에서 행 토큰이 지워지면 신규로 추정하지 않고 재다운로드를 안내한다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("학생")!.getCell(`${STUDENT_TOKEN_CELL}2`).value = null;

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    const stripped = preview.rows.find((r) => r.issues.some((i) => i.code === "ROW_TOKEN_MISSING"));
    expect(stripped?.kind).toBe("REVIEW");
    expect(preview.rows.some((r) => r.kind === "NEW")).toBe(false);
  });

  it("양식만 받은 파일에 적은 기존 이메일은 그 사람의 수정으로 다룬다", async () => {
    const template = await exportRoster(db, fx.main, YEAR, false, false);
    const book = await loadBook(template);
    const sheet = book.getWorksheet("학생")!;
    sheet.getCell("A2").value = "student-test@example.posan.kr";
    sheet.getCell("B2").value = 1;
    sheet.getCell("C2").value = 1;
    sheet.getCell("D2").value = 1;
    sheet.getCell(`${STUDENT_NAME_CELL}2`).value = "양식수정";
    sheet.getCell("F2").value = "남";

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    expect(preview.rows.filter((r) => r.kind === "CHANGED")).toHaveLength(1);
    expect(preview.rows.some((r) => r.kind === "NEW")).toBe(false);

    await commitRosterImport(db, commitInput(preview, "import-template"));
    expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).name).toBe("양식수정");
  });

  it("서버 대응표가 정리된 파일은 다시 내려받도록 안내한다", async () => {
    const bytes = await renamedStudentFile();
    await db.rosterFile.deleteMany({});
    await expectDomainCode(
      previewRosterImport(db, fx.main, YEAR, "PARTIAL", bytes),
      "INVALID_FILE",
    );
  });

  it("다른 학년도 파일은 YEAR_MISMATCH다", async () => {
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-mismatch",
      expectedVersion: await controlVersion(),
      kind: "DRAFT_YEAR",
      payloadHash: "draft",
      year: NEXT_YEAR,
    });

    const nextYearFile = await exportRoster(db, fx.main, NEXT_YEAR, true, false);
    const bytes = Uint8Array.from(nextYearFile).buffer;
    await expectDomainCode(previewRosterImport(db, fx.main, YEAR, "PARTIAL", bytes), "YEAR_MISMATCH");
  });

  it("교사 성별은 파일로 덮지 않는다", async () => {
    await db.userAcademicRecord.update({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
      data: { gender: "FEMALE" },
    });
    await db.user.update({ where: { id: fx.teacherId }, data: { gender: "FEMALE" } });

    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("교사")!.getCell(`${TEACHER_NAME_CELL}2`).value = "교사수정";
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    await commitRosterImport(db, commitInput(preview, "import-gender"));

    const record = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
    });
    expect(record.name).toBe("교사수정");
    expect(record.gender).toBe("FEMALE");
  });

  // -------------------------------------------------------------------------
  // 범위·누락
  // -------------------------------------------------------------------------

  it("PARTIAL은 파일에 없는 사람을 건드리지 않는다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("교사")!.spliceRows(2, 1);
    book.getWorksheet("학생")!.getCell(`${STUDENT_NAME_CELL}2`).value = "수정이름";

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    expect(preview.missingUserIds).toEqual([]);

    const teacherBefore = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
    });
    await commitRosterImport(db, commitInput(preview, "import-partial"));
    const teacherAfter = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
    });
    expect(teacherAfter).toEqual(teacherBefore);
  });

  it("ACTIVE의 FULL은 누락을 보고만 하고 아무 상태도 바꾸지 않는다", async () => {
    await addTeacher("teacher-two@example.posan.kr", "교사둘");
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    removeRowByEmail(book.getWorksheet("교사")!, "teacher-test@example.posan.kr");

    const preview = await previewRosterImport(db, fx.main, YEAR, "FULL", await toBytes(book));
    expect(preview.missingUserIds).toEqual([fx.teacherId]);

    await commitRosterImport(db, commitInput(preview, "import-full-active", { omissionsConfirmed: true }));

    const record = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
    });
    expect(record.memberState).toBe("EMPLOYED");
    const entry = await db.rosterEntry.findFirstOrThrow({ where: { year: YEAR, userId: fx.teacherId } });
    expect(entry.included).toBe(true);
  });

  it("헤더만 있는 시트는 그 역할을 건드리지 않는다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    book.getWorksheet("교사")!.spliceRows(2, 1);

    const preview = await previewRosterImport(db, fx.main, YEAR, "FULL", await toBytes(book));
    expect(preview.coveredRoles).toEqual(["STUDENT"]);
    expect(preview.missingUserIds).toEqual([]);
  });

  it("DRAFT의 FULL은 확인받은 누락만 included=false로 두고 계정은 지우지 않는다", async () => {
    await addTeacher("teacher-two@example.posan.kr", "교사둘");
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-create",
      expectedVersion: await controlVersion(),
      kind: "DRAFT_YEAR",
      payloadHash: "draft",
      year: NEXT_YEAR,
    });

    const exported = await exportRoster(db, fx.main, NEXT_YEAR, true, false);
    const book = await loadBook(exported);
    removeRowByEmail(book.getWorksheet("교사")!, "teacher-test@example.posan.kr");
    const preview = await previewRosterImport(db, fx.main, NEXT_YEAR, "FULL", await toBytes(book));
    expect(preview.missingUserIds).toEqual([fx.teacherId]);

    await commitRosterImport(
      db,
      commitInput(preview, "import-draft-full", {
        omissionsConfirmed: true,
        expectedVersion: await controlVersion(),
      }),
    );

    const teacherEntry = await db.rosterEntry.findFirstOrThrow({
      where: { year: NEXT_YEAR, userId: fx.teacherId },
    });
    expect(teacherEntry.included).toBe(false);
    const studentEntry = await db.rosterEntry.findFirstOrThrow({
      where: { year: NEXT_YEAR, userId: fx.studentId },
    });
    expect(studentEntry.included).toBe(true);

    // 초안 확정은 User와 확정 연도 기록을 건드리지 않는다.
    expect(await db.user.count({ where: { id: fx.teacherId } })).toBe(1);
    const activeRecord = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: YEAR, userId: fx.teacherId } },
    });
    expect(activeRecord.memberState).toBe("EMPLOYED");
  });

  it("지난 학년도는 그 해의 파일이라도 반영을 거절한다", async () => {
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

    const exported = await exportRoster(db, fx.main, pastYear, true, false);
    const bytes = Uint8Array.from(exported).buffer;

    try {
      await previewRosterImport(db, fx.main, pastYear, "PARTIAL", bytes);
      throw new Error("지난 학년도 반영이 거절되지 않았습니다.");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("YEAR_MISMATCH");
      expect((error as Error).message).toContain("기록 정정");
    }
  });

  // -------------------------------------------------------------------------
  // 취소·보존 정리
  // -------------------------------------------------------------------------

  it("취소는 즉시 사본을 비운다", async () => {
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());
    await cancelRosterImport(db, fx.main, YEAR, preview.id);

    const row = await db.rosterImport.findUniqueOrThrow({ where: { id: preview.id } });
    expect(row.state).toBe("CANCELLED");
    expect(row.payload).toBeNull();
    expect(row.preview).toBeNull();

    await expectDomainCode(commitRosterImport(db, commitInput(preview, "import-cancelled")), "VERSION_CONFLICT");
  });

  it("보존 정리는 경계를 지키고 PENDING이 참조하는 스냅샷은 남긴다", async () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const HOUR = 3600_000;
    const DAY = 24 * HOUR;

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());
    const young = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());
    await db.rosterImport.update({ where: { id: preview.id }, data: { createdAt: ago(24 * HOUR) } });
    await db.rosterImport.update({ where: { id: young.id }, data: { createdAt: ago(23 * HOUR + 59 * 60_000) } });

    const oldFile = await db.rosterFile.create({
      data: { year: YEAR, version: 0, schemaVersion: 1, manifest: {}, createdAt: ago(30 * DAY) },
    });
    const youngFile = await db.rosterFile.create({
      data: { year: YEAR, version: 0, schemaVersion: 1, manifest: {}, createdAt: ago(29 * DAY) },
    });

    const snapshotBase = {
      version: 1,
      activeYear: YEAR,
      lastEligibilityEventId: 0,
      payload: {},
      freshUntil: now,
      coversUntil: "2026-10-01",
    };
    const staleSnapshot = await db.kioskSnapshot.create({
      data: { ...snapshotBase, issuedAt: ago(30 * DAY) },
    });
    const referenced = await db.kioskSnapshot.create({
      data: { ...snapshotBase, issuedAt: ago(30 * DAY) },
    });
    await db.localCheckInReview.create({
      data: {
        clientKey: "pending-1",
        payloadHash: "h",
        payload: {},
        snapshotId: referenced.id,
        reason: "UNKNOWN",
        state: "PENDING",
      },
    });
    const resolvedOld = await db.localCheckInReview.create({
      data: {
        clientKey: "resolved-1",
        payloadHash: "h",
        payload: {},
        reason: "UNKNOWN",
        state: "ACCEPTED",
        resolvedAt: ago(30 * DAY),
      },
    });
    const resolvedYoung = await db.localCheckInReview.create({
      data: {
        clientKey: "resolved-2",
        payloadHash: "h",
        payload: {},
        reason: "UNKNOWN",
        state: "ACCEPTED",
        resolvedAt: ago(29 * DAY),
      },
    });

    await purgeExpiredRosterCopies(db, now);

    const expired = await db.rosterImport.findUniqueOrThrow({ where: { id: preview.id } });
    expect(expired.state).toBe("EXPIRED");
    expect(expired.payload).toBeNull();
    expect(expired.preview).toBeNull();
    expect((await db.rosterImport.findUniqueOrThrow({ where: { id: young.id } })).state).toBe("PREVIEW");

    expect(await db.rosterFile.findUnique({ where: { id: oldFile.id } })).toBeNull();
    expect(await db.rosterFile.findUnique({ where: { id: youngFile.id } })).not.toBeNull();

    expect(await db.kioskSnapshot.findUnique({ where: { id: staleSnapshot.id } })).toBeNull();
    expect(await db.kioskSnapshot.findUnique({ where: { id: referenced.id } })).not.toBeNull();

    expect((await db.localCheckInReview.findUniqueOrThrow({ where: { id: resolvedOld.id } })).payload).toBeNull();
    expect(
      (await db.localCheckInReview.findUniqueOrThrow({ where: { id: resolvedYoung.id } })).payload,
    ).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  describe("API", () => {
    async function postImport(body: FormData, year = String(YEAR)) {
      const { POST } = await import("@/app/api/admin/academic-years/[year]/imports/route");
      return POST(new Request("http://localhost/api/admin/academic-years/2026/imports", {
        method: "POST",
        body,
      }), { params: Promise.resolve({ year }) });
    }

    function formOf(bytes: ArrayBuffer, scope = "PARTIAL"): FormData {
      const form = new FormData();
      form.set("file", new File([bytes], "roster.xlsx"), "roster.xlsx");
      form.set("scope", scope);
      return form;
    }

    it("용량 초과는 413이다", async () => {
      const previous = process.env.MAX_FILE_SIZE_MB;
      process.env.MAX_FILE_SIZE_MB = "1";
      try {
        const big = new FormData();
        big.set("file", new File([new Uint8Array(2 * 1024 * 1024)], "big.xlsx"), "big.xlsx");
        big.set("scope", "PARTIAL");
        const response = await postImport(big);
        expect(response.status).toBe(413);
      } finally {
        if (previous === undefined) delete process.env.MAX_FILE_SIZE_MB;
        else process.env.MAX_FILE_SIZE_MB = previous;
      }
    });

    it("읽을 수 없는 파일은 422다", async () => {
      const response = await postImport(formOf(new Uint8Array([1, 2, 3, 4]).buffer));
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("INVALID_FILE");
    });

    it("읽기 전용 관리자는 403이다", async () => {
      const reader = await db.user.create({
        data: {
          email: "sub@example.posan.kr",
          emailKey: "sub@example.posan.kr",
          name: "부관리자",
          role: "TEACHER",
          adminLevel: "SUBADMIN",
        },
      });
      mocks.auth.mockResolvedValue({
        user: { dbUserId: reader.id, role: "TEACHER", sessionVersion: reader.sessionVersion },
      });

      const response = await postImport(formOf(await renamedStudentFile()));
      expect(response.status).toBe(403);
    });

    it("PREPARING 동안에는 503이다", async () => {
      const bytes = await renamedStudentFile();
      await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
      const response = await postImport(formOf(bytes));
      expect(response.status).toBe(503);
    });

    it("정상 업로드는 미리보기를 돌려주고 확정 route가 수령증을 준다", async () => {
      const response = await postImport(formOf(await renamedStudentFile()));
      expect(response.status).toBe(200);
      const preview = (await response.json()).preview as ImportPreview;
      expect(preview.canCommit).toBe(true);

      const { POST } = await import("@/app/api/admin/academic-years/[year]/imports/[id]/commit/route");
      const commit = await POST(
        new Request("http://localhost/commit", {
          method: "POST",
          body: JSON.stringify({
            requestId: "route-commit",
            expectedVersion: preview.controlVersion,
            confirmedNewRowTokens: [],
            omissionsConfirmed: false,
          }),
          headers: { "Content-Type": "application/json" },
        }),
        { params: Promise.resolve({ year: String(YEAR), id: preview.id }) },
      );
      expect(commit.status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).name).toBe("수정이름");
    });
  });

  // -------------------------------------------------------------------------
  // 검토 1차: 누락 처리·신규 행 재검사·파일 귀속
  // -------------------------------------------------------------------------

  async function draftWithTwoTeachers(): Promise<void> {
    await addTeacher("teacher-two@example.posan.kr", "교사둘");
    await createDraftYear(db, {
      actor: fx.main,
      requestId: `draft-${crypto.randomUUID()}`,
      expectedVersion: await controlVersion(),
      kind: "DRAFT_YEAR",
      payloadHash: "draft",
      year: NEXT_YEAR,
    });
  }

  async function draftFullPreviewOmittingTeacher(): Promise<ImportPreview> {
    const exported = await exportRoster(db, fx.main, NEXT_YEAR, true, false);
    const book = await loadBook(exported);
    removeRowByEmail(book.getWorksheet("교사")!, "teacher-test@example.posan.kr");
    return previewRosterImport(db, fx.main, NEXT_YEAR, "FULL", await toBytes(book));
  }

  it("누락된 초안 항목을 미리보기 뒤 누군가 고치면 확정이 물린다", async () => {
    await draftWithTwoTeachers();
    const preview = await draftFullPreviewOmittingTeacher();
    expect(preview.missingUserIds).toEqual([fx.teacherId]);

    const before = await db.rosterEntry.findFirstOrThrow({
      where: { year: NEXT_YEAR, userId: fx.teacherId },
    });
    await db.rosterEntry.update({
      where: { id: before.id },
      data: {
        draftProfile: { ...(before.draftProfile as object), name: "다른관리자가고친이름" },
        version: { increment: 1 },
      },
    });

    await expectDomainCode(
      commitRosterImport(
        db,
        commitInput(preview, "import-omitted-drift", {
          omissionsConfirmed: true,
          expectedVersion: await controlVersion(),
        }),
      ),
      "VERSION_CONFLICT",
    );

    const after = await db.rosterEntry.findUniqueOrThrow({ where: { id: before.id } });
    expect((after.draftProfile as { name: string }).name).toBe("다른관리자가고친이름");
    expect(after.included).toBe(true);
  });

  it("누락 확정은 included와 version만 바꾸고 초안 값은 한 글자도 건드리지 않는다", async () => {
    await draftWithTwoTeachers();
    const preview = await draftFullPreviewOmittingTeacher();

    const before = await db.rosterEntry.findFirstOrThrow({
      where: { year: NEXT_YEAR, userId: fx.teacherId },
    });

    await commitRosterImport(
      db,
      commitInput(preview, "import-omitted-ok", {
        omissionsConfirmed: true,
        expectedVersion: await controlVersion(),
      }),
    );

    const after = await db.rosterEntry.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.draftProfile).toEqual(before.draftProfile);
    expect(after.draftEmail).toBe(before.draftEmail);
    expect(after.emailKey).toBe(before.emailKey);
    expect(after.userId).toBe(before.userId);
    expect(after.included).toBe(false);
    expect(after.version).toBe(before.version + 1);
  });

  /** 파일에 있는 기존 계정을 그 해 명부로 처음 끌어오는 행을 만든다. */
  async function previewAddingOutsider(): Promise<{ preview: ImportPreview; userId: number }> {
    const outsider = await db.user.create({
      data: {
        email: "outsider@example.posan.kr",
        emailKey: "outsider@example.posan.kr",
        name: "명부밖학생",
        role: "STUDENT",
        grade: 2,
        classNum: 5,
        number: 9,
        gender: "MALE",
      },
    });

    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    const sheet = book.getWorksheet("학생")!;
    sheet.getCell("A3").value = "outsider@example.posan.kr";
    sheet.getCell("B3").value = 2;
    sheet.getCell("C3").value = 5;
    sheet.getCell("D3").value = 9;
    sheet.getCell(`${STUDENT_NAME_CELL}3`).value = "파일이름";
    sheet.getCell("F3").value = "남";

    return {
      preview: await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book)),
      userId: outsider.id,
    };
  }

  it("기존 계정을 명부로 끌어오는 신규 행은 덮게 될 현재 값을 보여 준다", async () => {
    const { preview } = await previewAddingOutsider();
    const row = preview.rows.find((r) => r.kind === "NEW");
    expect(row?.before?.name).toBe("명부밖학생");
  });

  it("신규 행이 가리킨 계정이 미리보기 뒤 바뀌면 확정이 물린다", async () => {
    for (const change of [
      { profileVersion: { increment: 1 } },
      { accessState: "INACTIVE" },
      { role: "TEACHER" as const },
    ]) {
      await resetAcademicTestDb(db);
      fx = await prepareAcademicFixture(db, pgClient);

      const { preview, userId } = await previewAddingOutsider();
      const token = preview.rows.find((r) => r.kind === "NEW")!.token;
      await db.user.update({ where: { id: userId }, data: change });

      await expectDomainCode(
        commitRosterImport(
          db,
          commitInput(preview, `import-account-drift-${crypto.randomUUID()}`, {
            confirmedNewRowTokens: [token],
          }),
        ),
        "VERSION_CONFLICT",
      );
      expect(
        await db.userAcademicRecord.findUnique({ where: { year_userId: { year: YEAR, userId } } }),
      ).toBeNull();
    }
  });

  it("미리보기 때 비어 있던 이메일을 그 사이 누가 차지하면 확정이 물린다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    const sheet = book.getWorksheet("학생")!;
    sheet.getCell("A3").value = "late@example.posan.kr";
    sheet.getCell("B3").value = 3;
    sheet.getCell("C3").value = 2;
    sheet.getCell("D3").value = 5;
    sheet.getCell(`${STUDENT_NAME_CELL}3`).value = "늦은신입";
    sheet.getCell("F3").value = "여";

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    const token = preview.rows.find((r) => r.kind === "NEW")!.token;

    await db.user.create({
      data: {
        email: "late@example.posan.kr",
        emailKey: "late@example.posan.kr",
        name: "먼저차지",
        role: "STUDENT",
      },
    });

    await expectDomainCode(
      commitRosterImport(
        db,
        commitInput(preview, "import-email-taken", { confirmedNewRowTokens: [token] }),
      ),
      "VERSION_CONFLICT",
    );
    expect((await db.user.findFirstOrThrow({ where: { email: "late@example.posan.kr" } })).name).toBe(
      "먼저차지",
    );
  });

  it("다른 학년도로 발행된 파일은 __meta 연도를 고쳐도 거절한다", async () => {
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-manifest",
      expectedVersion: await controlVersion(),
      kind: "DRAFT_YEAR",
      payloadHash: "draft",
      year: NEXT_YEAR,
    });

    const exported = await exportRoster(db, fx.main, NEXT_YEAR, true, false);
    const book = await loadBook(exported);
    const meta = book.getWorksheet("__meta")!;
    meta.getCell("B2").value = YEAR;

    await expectDomainCode(
      previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book)),
      "YEAR_MISMATCH",
    );
  });

  it("같은 사람을 두 번 적은 파일은 두 행 모두 REVIEW다", async () => {
    const template = await exportRoster(db, fx.main, YEAR, false, false);
    const book = await loadBook(template);
    const sheet = book.getWorksheet("학생")!;
    for (const r of [2, 3]) {
      sheet.getCell(`A${r}`).value = "student-test@example.posan.kr";
      sheet.getCell(`B${r}`).value = 1;
      sheet.getCell(`C${r}`).value = 1;
      sheet.getCell(`D${r}`).value = r;
      sheet.getCell(`${STUDENT_NAME_CELL}${r}`).value = `중복${r}`;
      sheet.getCell(`F${r}`).value = "남";
    }

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    const flagged = preview.rows.filter((r) =>
      r.issues.some((i) => i.code === "DUPLICATE_ROSTER_MATCH"),
    );
    expect(flagged).toHaveLength(2);
    expect(flagged.every((r) => r.kind === "REVIEW")).toBe(true);
    expect(preview.canCommit).toBe(false);
  });

  it("미리보기·취소·선택은 다른 학년도 경로에서 손댈 수 없다", async () => {
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-scope",
      expectedVersion: await controlVersion(),
      kind: "DRAFT_YEAR",
      payloadHash: "draft",
      year: NEXT_YEAR,
    });
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());

    await expectDomainCode(
      resolveImportConflicts(db, fx.main, NEXT_YEAR, preview.id, []),
      "YEAR_MISMATCH",
    );
    await expectDomainCode(cancelRosterImport(db, fx.main, NEXT_YEAR, preview.id), "YEAR_MISMATCH");
    await expectDomainCode(
      commitRosterImport(db, commitInput(preview, "import-wrong-year", { year: NEXT_YEAR })),
      "YEAR_MISMATCH",
    );

    expect((await db.rosterImport.findUniqueOrThrow({ where: { id: preview.id } })).state).toBe("PREVIEW");
  });

  it("충돌이 아닌 행에는 선택을 저장할 수 없다", async () => {
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());
    const changed = preview.rows.find((r) => r.kind === "CHANGED")!;

    await expectDomainCode(
      resolveImportConflicts(db, fx.main, YEAR, preview.id, [
        { token: changed.token, resolution: "USE_FILE" },
      ]),
      "REVIEW_REQUIRED",
    );
  });

  it("파일 수준 이슈가 있으면 확정이 막힌다", async () => {
    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    // 이름 칸에 수식을 넣으면 값이 감춰지므로 파서가 파일 이슈로 잡는다.
    book.getWorksheet("학생")!.getCell(`${STUDENT_NAME_CELL}2`).value = { formula: "A2", result: "x" };

    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await toBytes(book));
    expect(preview.fileIssues?.length).toBeGreaterThan(0);
    expect(preview.canCommit).toBe(false);
    await expectDomainCode(
      commitRosterImport(db, commitInput(preview, "import-file-issue")),
      "REVIEW_REQUIRED",
    );
  });

  it("확정된 미리보기에는 더 이상 선택을 저장할 수 없다", async () => {
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", await renamedStudentFile());
    await commitRosterImport(db, commitInput(preview, "import-then-resolve"));

    await expectDomainCode(
      resolveImportConflicts(db, fx.main, YEAR, preview.id, []),
      "VERSION_CONFLICT",
    );
    expect((await db.rosterImport.findUniqueOrThrow({ where: { id: preview.id } })).state).toBe("COMMITTED");
  });

  // -------------------------------------------------------------------------
  // 성능
  // -------------------------------------------------------------------------

  it("1,000행 파일의 확정이 60초 제한 안에 끝난다", async () => {
    const rows: RosterRow[] = Array.from({ length: 1000 }, (_, i) => ({
      entryId: crypto.randomUUID(),
      userId: null,
      email: `bulk-${i}@example.posan.kr`,
      emailKey: `bulk-${i}@example.posan.kr`,
      profile: {
        role: "STUDENT" as const,
        name: `대량학생${i}`,
        grade: 1,
        classNum: 1 + Math.floor(i / 30),
        number: 10 + (i % 30),
        gender: i % 2 === 0 ? ("MALE" as const) : ("FEMALE" as const),
        subject: null,
        homeroom: null,
        position: null,
      },
      baseUserVersion: null,
      included: true,
    }));
    await db.$transaction((tx) => writeRosterProfiles(tx, YEAR, rows), { timeout: 60_000 });

    const exported = await exportRoster(db, fx.main, YEAR, true, false);
    const book = await loadBook(exported);
    const sheet = book.getWorksheet("학생")!;
    for (let r = 2; r <= sheet.actualRowCount; r++) {
      sheet.getCell(`${STUDENT_NAME_CELL}${r}`).value = `이름${r}`;
    }
    const bytes = await toBytes(book);

    const startedAt = Date.now();
    const preview = await previewRosterImport(db, fx.main, YEAR, "PARTIAL", bytes);
    expect(preview.canCommit).toBe(true);
    const receipt = await commitRosterImport(db, commitInput(preview, "import-bulk"));
    const elapsedMs = Date.now() - startedAt;

    expect(receipt.changed).toBeGreaterThanOrEqual(1000);
    expect(elapsedMs).toBeLessThan(60_000);
    console.info(`[task-7] 1,000행 미리보기+확정 ${elapsedMs}ms`);
  }, 180_000);
});
