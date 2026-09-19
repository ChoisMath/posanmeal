import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { MEAL_KINDS } from "@/lib/meal-plan";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";

// 이름·학년·반·번호·교과·담임·직위는 학년도 명부가 소유한다. 본인이 고칠 수 있는
// 항목이 하나도 남지 않아 PUT을 내보내지 않는다(Next.js가 405로 답한다).
export async function GET() {
  return routeResponse(async () => {
    const userId = selfUserId(await requireActor("SIGNED_IN"));

    const [user, todayRows] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, name: true, role: true,
          grade: true, classNum: true, number: true,
          subject: true, homeroom: true, position: true,
          photoUrl: true,
        },
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

    const todayMeals = MEAL_KINDS.filter((kind) => todayRows.some((r) => r.mealKind === kind));

    return NextResponse.json({ user: { ...user, todayMeals } });
  });
}
