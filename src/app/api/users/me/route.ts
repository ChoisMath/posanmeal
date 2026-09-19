import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { MEAL_KINDS } from "@/lib/meal-plan";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";
import { getReportProfiles } from "@/lib/academic-year/report-profile";
import { activeYear } from "@/lib/academic-year/roster-service";

// 이름·학년·반·번호·교과·담임·직위는 학년도 명부가 소유한다. 본인이 고칠 수 있는
// 항목이 하나도 남지 않아 PUT을 내보내지 않는다(Next.js가 405로 답한다).
export async function GET() {
  return routeResponse(async () => {
    const userId = selfUserId(await requireActor("SIGNED_IN"));

    const [user, todayRows] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, photoUrl: true },
      }),
      prisma.mealRegistrationMealDate.findMany({
        where: {
          date: dateKeyToUtcDate(todayKST()),
          registration: { userId, status: "APPROVED" },
        },
        select: { mealKind: true },
        distinct: ["mealKind"],
      }),
    ]);

    if (!user) {
      throw new DomainError("MISSING_PROFILE", "사용자를 찾을 수 없습니다.");
    }

    // 확정된 오늘 식사는 공고의 학년도로 거르지 않는다. 조기 전환 뒤에도 2월에 남은
    // 확정일은 그대로 유효하다.
    const todayMeals = MEAL_KINDS.filter((kind) => todayRows.some((r) => r.mealKind === kind));

    const academicYear = await activeYear(prisma);
    const report = (await getReportProfiles(prisma, [userId], academicYear, false)).get(userId);
    const profile = report?.historical;

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: profile?.role ?? user.role,
        name: profile?.name ?? "",
        grade: profile?.grade ?? null,
        classNum: profile?.classNum ?? null,
        number: profile?.number ?? null,
        subject: profile?.subject ?? null,
        homeroom: profile?.homeroom ?? null,
        position: profile?.position ?? null,
        photoUrl: user.photoUrl,
        academicYear,
        ...(report?.warning ? { profileWarning: report.warning } : {}),
        todayMeals,
      },
    });
  });
}
