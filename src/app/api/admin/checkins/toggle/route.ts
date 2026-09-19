import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { MealKind } from "@/lib/meal-kind";
import { academicYearOfDate } from "@/lib/academic-year/calendar";
import { assertActor } from "@/lib/academic-year/access";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { getReportProfiles } from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";

// POST /api/admin/checkins/toggle
// body: { userId: number, date: "YYYY-MM-DD", action: "cycle" | "toggle", mealKind?: MealKind }
//
// 명부 잠금(RosterControl)을 잡지 않는다. 체크인 정정은 명부 변경이 아니고, 명부
// 작업 중에도 식당 현장의 정정이 막히면 안 된다.
export async function POST(request: Request) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");

    const body: {
      userId?: number;
      date?: string;
      action?: string;
      mealKind?: MealKind;
    } | null = await request.json().catch(() => null);

    const userId = body?.userId;
    const date = body?.date;
    const action = body?.action;
    const mealKind = body?.mealKind ?? "DINNER";

    if (
      typeof userId !== "number"
      || typeof date !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || (action !== "cycle" && action !== "toggle")
      || (mealKind !== "BREAKFAST" && mealKind !== "LUNCH" && mealKind !== "DINNER")
    ) {
      throw new DomainError("INVALID_INPUT", "잘못된 요청입니다.");
    }

    const targetDate = new Date(`${date}T00:00:00.000Z`);
    const year = academicYearOfDate(date);

    const state = await prisma.$transaction(async (tx) => {
      await assertActor(tx, actor, "WRITE_ADMIN");

      // 그 날짜가 속한 학년도의 소속으로 판정한다. 지금 졸업했다는 이유로 과거
      // 기록을 고치지 못하게 하지 않는다.
      const profile = (await getReportProfiles(tx, [userId], year, false)).get(userId)?.historical;

      const existing = await tx.checkIn.findUnique({
        where: { userId_date_mealKind: { userId, date: targetDate, mealKind } },
        select: { id: true, type: true },
      });

      // 기록이 없다고 정정을 막으면 "확인 필요"로 남은 줄을 영영 고칠 수 없다. 표기는
      // 그대로 경고로 두고, 학생/교사 갈래만 기존 기록이나 계정 역할로 정한다.
      const role = profile?.role
        ?? (existing ? (existing.type === "STUDENT" ? "STUDENT" : "TEACHER") : null)
        ?? (await tx.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role;
      if (!role) {
        throw new DomainError("MISSING_PROFILE", "사용자를 찾을 수 없습니다.");
      }
      if (action === "cycle" && role !== "TEACHER") {
        throw new DomainError("INVALID_INPUT", "교사에게만 적용합니다.");
      }
      if (action === "toggle" && role !== "STUDENT") {
        throw new DomainError("INVALID_INPUT", "학생에게만 적용합니다.");
      }

      if (action === "cycle") {
        if (!existing) {
          await tx.checkIn.create({
            data: { userId, date: targetDate, mealKind, type: "WORK", source: "ADMIN_MANUAL" },
          });
          return "WORK";
        }
        if (existing.type === "WORK") {
          await tx.checkIn.update({ where: { id: existing.id }, data: { type: "PERSONAL" } });
          return "PERSONAL";
        }
        await tx.checkIn.delete({ where: { id: existing.id } });
        return "empty";
      }

      if (!existing) {
        await tx.checkIn.create({
          data: { userId, date: targetDate, mealKind, type: "STUDENT", source: "ADMIN_MANUAL" },
        });
        return "STUDENT";
      }

      await tx.checkIn.delete({ where: { id: existing.id } });
      return "empty";
    });

    return NextResponse.json({ success: true, state });
  });
}
