import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { MEAL_KINDS } from "@/lib/meal-plan";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";

/** 명부(학년도 기준 정보)가 소유하는 필드. 본인이 직접 고칠 수 없다. */
const ROSTER_OWNED_FIELDS = [
  "name",
  "role",
  "grade",
  "classNum",
  "number",
  "gender",
  "subject",
  "homeroom",
  "position",
  "email",
  "adminLevel",
  "accessState",
] as const;

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

export async function PUT(request: Request) {
  return routeResponse(async () => {
    selfUserId(await requireActor("SIGNED_IN"));

    const body: unknown = await request.json().catch(() => null);
    const keys = typeof body === "object" && body !== null ? Object.keys(body) : [];
    const rosterKeys = keys.filter((key) =>
      (ROSTER_OWNED_FIELDS as readonly string[]).includes(key),
    );

    if (rosterKeys.length > 0) {
      throw new DomainError(
        "FORBIDDEN",
        "이름·소속·담당 정보는 학년도 명부에서만 바꿀 수 있습니다. 관리자에게 요청하세요.",
      );
    }

    throw new DomainError("MISSING_PROFILE", "이 화면에서 바꿀 수 있는 항목이 없습니다.");
  });
}
