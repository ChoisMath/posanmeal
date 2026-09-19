import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { openAcademicTestDb, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

let db: PrismaClient;
let fx: AcademicFixture;
let sessionUser: { dbUserId: number; role: string; sessionVersion?: number };
vi.mock("@/lib/prisma", () => ({ get prisma() { return db; } }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: sessionUser }) }));
const original = (userId: number, date = "2026-02-28") => ({ userId, date, type: "STUDENT", checkedAt: `${date}T09:00:42.000Z` });
async function get(query: string) {
  const { GET } = await import("@/app/api/admin/checkin-reviews/route");
  return GET(new Request(`http://localhost/api/admin/checkin-reviews${query}`));
}

describe("관리자 체크인 검토 목록", () => {
  beforeAll(async () => { db = await openAcademicTestDb(); });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db);
    sessionUser = { dbUserId: 0, role: "ADMIN" };
  });

  it("늦게 접수된 2월 기록은 현재 학급 대신 전년도 역사 이름·학번을 보여준다", async () => {
    await db.academicYear.create({ data: { year: 2025, state: "ARCHIVED" } });
    await db.userAcademicRecord.create({ data: { year: 2025, userId: fx.studentId, role: "STUDENT", name: "지난 이름",
      grade: 1, classNum: 2, number: 3, memberState: "ENROLLED" } });
    await db.user.update({ where: { id: fx.studentId }, data: { name: "현재 이름", grade: 3, classNum: 9, number: 9 } });
    await db.localCheckInReview.create({ data: { id: "past", clientKey: "past:1", payloadHash: "past", payload: original(fx.studentId),
      reason: "식사 구분 없음", state: "PENDING", createdAt: new Date("2026-09-19T00:00:00Z") } });
    const response = await get("?state=PENDING");
    expect(response.status).toBe(200);
    const { reviews } = await response.json();
    expect(reviews[0]).toMatchObject({ payload: { checkedAt: "2026-02-28T09:00:42.000Z" },
      subject: { name: "지난 이름", year: 2025, affiliation: "1학년 2반 3번", warning: null } });
  });

  it("연도 정보가 없으면 이름만 보완하고 현재 학급을 과거 학급으로 대신하지 않는다", async () => {
    await db.user.update({ where: { id: fx.studentId }, data: { name: "찾을 이름", grade: 3, classNum: 9 } });
    await db.localCheckInReview.create({ data: { clientKey: "missing:1", payloadHash: "missing", payload: original(fx.studentId, "2024-09-19"),
      reason: "당시 근거 없음", state: "PENDING" } });
    const { reviews } = await (await get("?state=PENDING")).json();
    expect(reviews[0].subject).toEqual({ name: "찾을 이름", year: 2024, affiliation: "학년도 정보 확인 필요", warning: "학년도 정보 확인 필요" });
  });

  it("id 조회는 최신 200개 밖의 처리 결과와 원본 정리 상태도 정확히 가져온다", async () => {
    await db.localCheckInReview.create({ data: { id: "old", clientKey: "old:1", payloadHash: "old", reason: "원본 보존기간 종료",
      state: "DUPLICATE", decision: { decision: "ACCEPT", reason: "이미 체크인됨" }, createdAt: new Date("2020-01-01") } });
    await db.localCheckInReview.createMany({ data: Array.from({ length: 201 }, (_, i) => ({
      id: `new-${i}`, clientKey: `new:${i}`, payloadHash: `hash-${i}`, reason: "테스트", state: "PENDING",
    })) });
    const list = await (await get("")).json();
    expect(list.reviews).toHaveLength(200);
    expect(list.reviews.some((row: { id: string }) => row.id === "old")).toBe(false);
    const exact = await (await get("?id=old")).json();
    expect(exact.reviews).toEqual([expect.objectContaining({ id: "old", state: "DUPLICATE", payload: null, subject: null })]);
    expect((await (await get("?id=old&state=PENDING")).json()).reviews).toEqual([]);
  });

  it("SUBADMIN은 목록만 읽고 같은 검토를 승인할 수 없으며 PREPARING을 안내한다", async () => {
    await db.user.update({ where: { id: fx.teacherId }, data: { adminLevel: "SUBADMIN" } });
    sessionUser = { dbUserId: fx.teacherId, role: "TEACHER", sessionVersion: 0 };
    expect((await get("?state=PENDING")).status).toBe(200);
    const { PUT } = await import("@/app/api/admin/checkin-reviews/[id]/route");
    const denied = await PUT(new Request("http://localhost/review", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "denied", decision: "REJECT", reason: "사유" }) }), { params: Promise.resolve({ id: "old" }) });
    expect(denied.status).toBe(403);
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
    expect((await get("?state=PENDING")).status).toBe(503);
  });
});
