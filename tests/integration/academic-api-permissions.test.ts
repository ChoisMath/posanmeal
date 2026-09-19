import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

type SessionUser = {
  dbUserId: number;
  role: string;
  adminLevel?: string;
  sessionVersion?: number;
};

const session = vi.hoisted(() => ({ current: null as SessionUser | null }));

vi.mock("@/auth", () => ({
  auth: async () => (session.current ? { user: session.current } : null),
}));

vi.mock("@/lib/prisma", async () => {
  const { openAcademicTestDb: open } = await import("./support/db");
  return { prisma: await open() };
});

const SEED_YEAR = 2026;
const DRAFT_YEAR = 2027;

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formRequest(): Request {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "roster.xlsx"));
  form.set("scope", "PARTIAL");
  return new Request("http://localhost/api", { method: "POST", body: form });
}

function yearParams(year: number) {
  return { params: Promise.resolve({ year: String(year) }) };
}

describe("academic admin API permissions", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;
  let subadminId: number;
  let subadminSessionVersion: number;
  let routes: {
    years: typeof import("@/app/api/admin/academic-years/route");
    roster: typeof import("@/app/api/admin/academic-years/[year]/roster/route");
    records: typeof import("@/app/api/admin/academic-years/[year]/records/[userId]/route");
    imports: typeof import("@/app/api/admin/academic-years/[year]/imports/route");
    importItem: typeof import("@/app/api/admin/academic-years/[year]/imports/[id]/route");
    commit: typeof import("@/app/api/admin/academic-years/[year]/imports/[id]/commit/route");
    review: typeof import("@/app/api/admin/academic-years/[year]/review/route");
    decisions: typeof import("@/app/api/admin/academic-years/[year]/decisions/route");
    activate: typeof import("@/app/api/admin/academic-years/[year]/activate/route");
    email: typeof import("@/app/api/admin/users/[id]/email/route");
    access: typeof import("@/app/api/admin/users/[id]/access/route");
    permissions: typeof import("@/app/api/admin/users/[id]/permissions/route");
    legacyImport: typeof import("@/app/api/admin/import/route");
    legacyUsers: typeof import("@/app/api/admin/users/route");
  };

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
    routes = {
      years: await import("@/app/api/admin/academic-years/route"),
      roster: await import("@/app/api/admin/academic-years/[year]/roster/route"),
      records: await import("@/app/api/admin/academic-years/[year]/records/[userId]/route"),
      imports: await import("@/app/api/admin/academic-years/[year]/imports/route"),
      importItem: await import("@/app/api/admin/academic-years/[year]/imports/[id]/route"),
      commit: await import("@/app/api/admin/academic-years/[year]/imports/[id]/commit/route"),
      review: await import("@/app/api/admin/academic-years/[year]/review/route"),
      decisions: await import("@/app/api/admin/academic-years/[year]/decisions/route"),
      activate: await import("@/app/api/admin/academic-years/[year]/activate/route"),
      email: await import("@/app/api/admin/users/[id]/email/route"),
      access: await import("@/app/api/admin/users/[id]/access/route"),
      permissions: await import("@/app/api/admin/users/[id]/permissions/route"),
      legacyImport: await import("@/app/api/admin/import/route"),
      legacyUsers: await import("@/app/api/admin/users/route"),
    };
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await (prisma as PrismaClient).$disconnect();
    await db.$disconnect();
    await pgClient.end();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
    const subadmin = await db.user.create({
      data: {
        email: "subadmin-test@example.posan.kr",
        name: "부관리자테스트",
        role: "TEACHER",
        adminLevel: "SUBADMIN",
      },
    });
    subadminId = subadmin.id;
    subadminSessionVersion = subadmin.sessionVersion;
    session.current = null;
  });

  function signInAsMain(): void {
    session.current = { dbUserId: 0, role: "ADMIN" };
  }

  function signInAsWriter(): void {
    if (fx.writer.kind !== "USER") throw new Error("fixture writer must be a user actor");
    session.current = {
      dbUserId: fx.writer.userId,
      role: "TEACHER",
      adminLevel: "ADMIN",
      sessionVersion: fx.writer.sessionVersion,
    };
  }

  function signInAsReader(): void {
    session.current = {
      dbUserId: subadminId,
      role: "TEACHER",
      adminLevel: "SUBADMIN",
      sessionVersion: subadminSessionVersion,
    };
  }

  async function controlVersion(): Promise<number> {
    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    return control.version;
  }

  describe("READ_ADMIN (서브관리자)", () => {
    it("명부를 조회할 수 있다", async () => {
      signInAsReader();
      const res = await routes.roster.GET(
        new Request("http://localhost/api"),
        yearParams(SEED_YEAR),
      );
      expect(res.status).toBe(200);
    });

    it("Excel 미리보기를 만들 수 없다", async () => {
      signInAsReader();
      const res = await routes.imports.POST(formRequest(), yearParams(SEED_YEAR));
      expect(res.status).toBe(403);
    });

    it("Excel 반영을 확정할 수 없다", async () => {
      signInAsReader();
      const res = await routes.commit.POST(
        jsonRequest("POST", {
          requestId: "read-admin-commit",
          expectedVersion: await controlVersion(),
          confirmedNewRowTokens: [],
          omissionsConfirmed: false,
        }),
        { params: Promise.resolve({ year: String(SEED_YEAR), id: "any-import" }) },
      );
      expect(res.status).toBe(403);
    });

    it("명부 셀을 편집할 수 없다", async () => {
      signInAsReader();
      const res = await routes.records.PUT(
        jsonRequest("PUT", {
          requestId: "read-admin-row",
          expectedRowVersion: 0,
          email: "student-test@example.posan.kr",
          profile: {
            role: "STUDENT",
            name: "학생테스트",
            grade: 2,
            classNum: 1,
            number: 1,
            gender: "MALE",
            subject: null,
            homeroom: null,
            position: null,
          },
        }),
        { params: Promise.resolve({ year: String(SEED_YEAR), userId: String(fx.studentId) }) },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("WRITE_ADMIN (관리자 교사)", () => {
    it("학년도를 전환할 수 없다", async () => {
      signInAsWriter();
      const res = await routes.activate.POST(
        jsonRequest("POST", {
          requestId: "writer-activate",
          expectedVersion: await controlVersion(),
          yearVersion: 0,
          sourceVersion: 0,
          kiosksPaused: true,
          warningsAcknowledged: true,
        }),
        yearParams(DRAFT_YEAR),
      );
      expect(res.status).toBe(403);
    });

    it("지난 명부를 삭제할 수 없다", async () => {
      signInAsWriter();
      const res = await routes.roster.DELETE(
        jsonRequest("DELETE", {
          requestId: "writer-delete",
          expectedVersion: await controlVersion(),
          entryIds: "ALL",
        }),
        yearParams(SEED_YEAR),
      );
      expect(res.status).toBe(403);
    });

    it("관리자 권한 등급을 바꿀 수 없다", async () => {
      signInAsWriter();
      const res = await routes.permissions.PUT(
        jsonRequest("PUT", { requestId: "writer-perm", expectedRowVersion: 0, level: "ADMIN" }),
        { params: Promise.resolve({ id: String(subadminId) }) },
      );
      expect(res.status).toBe(403);
    });

    it("초안 학년도를 만들 수 있다", async () => {
      signInAsWriter();
      const res = await routes.years.POST(
        jsonRequest("POST", {
          requestId: "writer-draft",
          expectedVersion: await controlVersion(),
          year: DRAFT_YEAR,
          sourceYear: SEED_YEAR,
        }),
        );
      expect(res.status).toBe(201);
    });
  });

  describe("MAIN (메인 관리자)", () => {
    it("권한 등급 변경이 권한 때문에 막히지 않는다", async () => {
      signInAsMain();
      const user = await db.user.findUniqueOrThrow({ where: { id: subadminId } });
      const res = await routes.permissions.PUT(
        jsonRequest("PUT", {
          requestId: "main-perm",
          expectedRowVersion: user.profileVersion,
          level: "NONE",
        }),
        { params: Promise.resolve({ id: String(subadminId) }) },
      );
      expect(res.status).toBe(200);
      const after = await db.user.findUniqueOrThrow({ where: { id: subadminId } });
      expect(after.adminLevel).toBe("NONE");
    });

    it("지난 명부 삭제가 권한 때문에 막히지 않는다", async () => {
      signInAsMain();
      const res = await routes.roster.DELETE(
        jsonRequest("DELETE", {
          requestId: "main-delete",
          expectedVersion: await controlVersion(),
          entryIds: "ALL",
        }),
        yearParams(SEED_YEAR),
      );
      expect(res.status).not.toBe(403);
    });
  });

  describe("요청 본문의 가짜 신원", () => {
    it("본문 actor/adminLevel은 권한을 바꾸지 못한다", async () => {
      signInAsReader();
      const res = await routes.records.PUT(
        jsonRequest("PUT", {
          requestId: "forged-actor",
          expectedRowVersion: 0,
          email: "student-test@example.posan.kr",
          actor: { kind: "MAIN", userId: null, sessionVersion: null },
          adminLevel: "ADMIN",
          profile: {
            role: "STUDENT",
            name: "학생테스트",
            grade: 2,
            classNum: 1,
            number: 1,
            gender: "MALE",
            subject: null,
            homeroom: null,
            position: null,
          },
        }),
        { params: Promise.resolve({ year: String(SEED_YEAR), userId: String(fx.studentId) }) },
      );
      expect(res.status).toBe(403);
    });

    it("본문 actor를 MAIN으로 보내도 WRITE_ADMIN은 전환할 수 없다", async () => {
      signInAsWriter();
      const res = await routes.activate.POST(
        jsonRequest("POST", {
          requestId: "forged-main",
          expectedVersion: await controlVersion(),
          yearVersion: 0,
          sourceVersion: 0,
          kiosksPaused: true,
          warningsAcknowledged: true,
          actor: { kind: "MAIN", userId: null, sessionVersion: null },
        }),
        yearParams(DRAFT_YEAR),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("미인증 요청", () => {
    it("모든 관리자 변경 API가 401로 막는다", async () => {
      session.current = null;
      const body = { requestId: "anon", expectedVersion: 0, expectedRowVersion: 0 };
      const cases: Array<[string, Promise<Response>]> = [
        ["years.POST", routes.years.POST(jsonRequest("POST", { ...body, year: DRAFT_YEAR }))],
        [
          "roster.DELETE",
          routes.roster.DELETE(
            jsonRequest("DELETE", { ...body, entryIds: "ALL" }),
            yearParams(SEED_YEAR),
          ),
        ],
        [
          "records.PUT",
          routes.records.PUT(jsonRequest("PUT", { ...body, email: "a@b.c", profile: {} }), {
            params: Promise.resolve({ year: String(SEED_YEAR), userId: String(fx.studentId) }),
          }),
        ],
        ["imports.POST", routes.imports.POST(formRequest(), yearParams(SEED_YEAR))],
        [
          "importItem.PATCH",
          routes.importItem.PATCH(jsonRequest("PATCH", { choices: [] }), {
            params: Promise.resolve({ year: String(SEED_YEAR), id: "x" }),
          }),
        ],
        [
          "importItem.DELETE",
          routes.importItem.DELETE(new Request("http://localhost/api", { method: "DELETE" }), {
            params: Promise.resolve({ year: String(SEED_YEAR), id: "x" }),
          }),
        ],
        [
          "commit.POST",
          routes.commit.POST(jsonRequest("POST", body), {
            params: Promise.resolve({ year: String(SEED_YEAR), id: "x" }),
          }),
        ],
        [
          "review.POST",
          routes.review.POST(new Request("http://localhost/api", { method: "POST" }), yearParams(DRAFT_YEAR)),
        ],
        [
          "decisions.POST",
          routes.decisions.POST(
            jsonRequest("POST", { ...body, userId: fx.studentId, decision: "GRADUATED" }),
            yearParams(DRAFT_YEAR),
          ),
        ],
        [
          "activate.POST",
          routes.activate.POST(
            jsonRequest("POST", {
              ...body,
              yearVersion: 0,
              sourceVersion: 0,
              kiosksPaused: true,
              warningsAcknowledged: true,
            }),
            yearParams(DRAFT_YEAR),
          ),
        ],
        [
          "email.PUT",
          routes.email.PUT(jsonRequest("PUT", { ...body, email: "a@b.c" }), {
            params: Promise.resolve({ id: String(fx.studentId) }),
          }),
        ],
        [
          "access.PUT",
          routes.access.PUT(
            jsonRequest("PUT", { ...body, state: "INACTIVE", reason: "TRANSFERRED" }),
            { params: Promise.resolve({ id: String(fx.studentId) }) },
          ),
        ],
        [
          "permissions.PUT",
          routes.permissions.PUT(jsonRequest("PUT", { ...body, level: "ADMIN" }), {
            params: Promise.resolve({ id: String(fx.studentId) }),
          }),
        ],
        ["legacyImport.POST", routes.legacyImport.POST()],
      ];

      for (const [name, pending] of cases) {
        const res = await pending;
        expect(res.status, name).toBe(401);
      }
    });
  });

  describe("옛 Sheet 가져오기", () => {
    it("인증된 관리자에게 410을 답하고 아무것도 쓰지 않는다", async () => {
      signInAsWriter();
      const before = await db.user.count();
      const res = await routes.legacyImport.POST();

      expect(res.status).toBe(410);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toMatch(/Excel/);
      expect(await db.user.count()).toBe(before);
    });
  });

  describe("계정 변경에 필요한 버전", () => {
    it("사용자 목록이 계정 변경용 profileVersion을 함께 준다", async () => {
      signInAsReader();
      const res = await routes.legacyUsers.GET(new Request("http://localhost/api"));
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        users: Array<{ id: number; profileVersion: number }>;
      };
      const student = body.users.find((user) => user.id === fx.studentId);
      const stored = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(student?.profileVersion).toBe(stored.profileVersion);
    });
  });

  describe("명부 조회 옵션", () => {
    it("기본 조회는 제외된 사람을 빼고 includeExcluded=1은 포함한다", async () => {
      signInAsWriter();
      await routes.years.POST(
        jsonRequest("POST", {
          requestId: "flags-draft",
          expectedVersion: await controlVersion(),
          year: DRAFT_YEAR,
          sourceYear: SEED_YEAR,
        }),
      );
      await db.rosterEntry.updateMany({
        where: { year: DRAFT_YEAR, userId: fx.studentId },
        data: { included: false },
      });

      signInAsReader();
      const plain = await routes.roster.GET(
        new Request("http://localhost/api"),
        yearParams(DRAFT_YEAR),
      );
      const withExcluded = await routes.roster.GET(
        new Request("http://localhost/api?includeExcluded=1"),
        yearParams(DRAFT_YEAR),
      );

      const plainBody = (await plain.json()) as { rows: Array<{ userId: number | null }> };
      const excludedBody = (await withExcluded.json()) as { rows: Array<{ userId: number | null }> };
      expect(plainBody.rows.some((row) => row.userId === fx.studentId)).toBe(false);
      expect(excludedBody.rows.some((row) => row.userId === fx.studentId)).toBe(true);
    });

    it("잘못된 조회 옵션 값은 422로 막는다", async () => {
      signInAsReader();
      const res = await routes.roster.GET(
        new Request("http://localhost/api?includeEntryless=maybe"),
        yearParams(SEED_YEAR),
      );
      expect(res.status).toBe(422);
    });

    it("명부를 지운 지난 학년도도 includeEntryless=1이면 보존 기록을 돌려준다", async () => {
      signInAsMain();
      await db.academicYear.update({ where: { year: SEED_YEAR }, data: { state: "ARCHIVED" } });
      const deleted = await routes.roster.DELETE(
        jsonRequest("DELETE", {
          requestId: "entryless-delete",
          expectedVersion: await controlVersion(),
          entryIds: "ALL",
        }),
        yearParams(SEED_YEAR),
      );
      expect(deleted.status).toBe(200);

      const plain = await routes.roster.GET(
        new Request("http://localhost/api"),
        yearParams(SEED_YEAR),
      );
      const entryless = await routes.roster.GET(
        new Request("http://localhost/api?includeEntryless=1"),
        yearParams(SEED_YEAR),
      );

      const plainBody = (await plain.json()) as { rows: unknown[] };
      const entrylessBody = (await entryless.json()) as { rows: unknown[] };
      expect(plainBody.rows).toHaveLength(0);
      expect(entrylessBody.rows.length).toBeGreaterThan(0);
    });
  });
});
