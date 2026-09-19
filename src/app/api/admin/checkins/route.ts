import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildMonthlyMealColumns } from "@/lib/meal-columns";
import { buildMonthDateRange, formatMonthDateKey } from "@/lib/date-range";
import { academicYearOfDate } from "@/lib/academic-year/calendar";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor } from "@/lib/academic-year/request-actor";
import { assertActor } from "@/lib/academic-year/access";
import {
  currentClassLabelOf,
  displayNameOf,
  getReportProfiles,
  isReportCategory,
  listPeriodCategory,
} from "@/lib/academic-year/report-profile";

function parseMonthParams(searchParams: URLSearchParams): { year: number; month: number } {
  const now = new Date();
  const year = Number.parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
  const month = Number.parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError("INVALID_INPUT", "조회 기간을 확인하세요.");
  }
  return { year, month };
}

// GET /api/admin/checkins?year=2026&month=3&category=teacher|1|2|3[&includeCurrent=1]
export async function GET(request: Request) {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");

    const { searchParams } = new URL(request.url);
    const { year, month } = parseMonthParams(searchParams);
    const category = searchParams.get("category") ?? "teacher";
    if (!isReportCategory(category)) {
      throw new DomainError("INVALID_INPUT", "조회 구분을 확인하세요.");
    }
    const includeCurrent = searchParams.get("includeCurrent") === "1";

    const { startDate, endDate } = buildMonthDateRange(year, month);
    // 한 달은 하나의 학년도에만 속한다(학년도 경계는 2월과 3월 사이다).
    const academicYear = academicYearOfDate(formatMonthDateKey(year, month, 1));

    const { ids: memberIds, profiles } = await listPeriodCategory(
      prisma,
      academicYear,
      { startDate, endDate },
      category,
      includeCurrent,
    );

    const [checkIns, activeRows] = await Promise.all([
      prisma.checkIn.findMany({
        where: { userId: { in: memberIds }, date: { gte: startDate, lte: endDate } },
        select: { id: true, userId: true, date: true, checkedAt: true, type: true, mealKind: true },
        orderBy: [{ date: "asc" }, { mealKind: "asc" }],
      }),
      prisma.mealRegistrationMealDate.findMany({
        where: {
          date: { gte: startDate, lte: endDate },
          mealKind: { in: ["BREAKFAST", "LUNCH"] },
          registration: { status: "APPROVED" },
        },
        select: { date: true, mealKind: true },
        distinct: ["date", "mealKind"],
      }),
    ]);

    type GridCheckIn = Omit<(typeof checkIns)[number], "userId">;
    const checkInsByUser = new Map<number, GridCheckIn[]>();
    for (const { userId, ...rest } of checkIns) {
      const list = checkInsByUser.get(userId);
      if (list) list.push(rest);
      else checkInsByUser.set(userId, [rest]);
    }

    const users = memberIds
      .map((userId) => {
        const report = profiles.get(userId);
        const profile = report?.historical;
        return {
          id: userId,
          name: displayNameOf(report),
          number: profile?.number ?? null,
          grade: profile?.grade ?? null,
          classNum: profile?.classNum ?? null,
          subject: profile?.subject ?? null,
          homeroom: profile?.homeroom ?? null,
          checkIns: checkInsByUser.get(userId) ?? [],
          ...(report?.warning ? { profileWarning: report.warning } : {}),
          ...(includeCurrent ? { currentClass: currentClassLabelOf(report) } : {}),
        };
      });

    const mealColumns = buildMonthlyMealColumns(year, month, {
      BREAKFAST: activeRows.filter((r) => r.mealKind === "BREAKFAST").map((r) => r.date),
      LUNCH: activeRows.filter((r) => r.mealKind === "LUNCH").map((r) => r.date),
    });

    return NextResponse.json({ users, year, month, category, academicYear, mealColumns });
  });
}

// PATCH /api/admin/checkins — 체크인 타입 수정 (교사 근무↔개인)
export async function PATCH(request: Request) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");

    const body: unknown = await request.json().catch(() => null);
    const id = (body as { id?: unknown })?.id;
    const type = (body as { type?: unknown })?.type;
    if (typeof id !== "number" || (type !== "WORK" && type !== "PERSONAL")) {
      throw new DomainError("INVALID_INPUT", "잘못된 요청입니다.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      await assertActor(tx, actor, "WRITE_ADMIN");

      const checkIn = await tx.checkIn.findUnique({
        where: { id },
        select: { id: true, date: true, userId: true, type: true },
      });
      if (!checkIn) {
        throw new DomainError("MISSING_PROFILE", "체크인 기록을 찾을 수 없습니다.");
      }

      const year = academicYearOfDate(checkIn.date.toISOString().slice(0, 10));
      const target = (await getReportProfiles(tx, [checkIn.userId], year, false)).get(checkIn.userId);
      // 기록이 비어 정정이 막히면 "확인 필요"로 남은 바로 그 줄을 고칠 수 없다.
      // 역할 판정에만 기존 기록의 유형을 대신 쓴다.
      const role = target?.historical?.role
        ?? (checkIn.type === "STUDENT" ? "STUDENT" : "TEACHER");
      if (role !== "TEACHER") {
        throw new DomainError("INVALID_INPUT", "교사의 체크인만 수정할 수 있습니다.");
      }

      return tx.checkIn.update({ where: { id }, data: { type } });
    });

    return NextResponse.json({ success: true, checkIn: updated });
  });
}
