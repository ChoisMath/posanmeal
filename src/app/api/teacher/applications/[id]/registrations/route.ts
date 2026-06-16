import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { homeroom: true },
  });
  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  const [gradeStr, classStr] = teacher.homeroom.split("-");
  const grade = parseInt(gradeStr);
  const classNum = parseInt(classStr);

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (Number.isNaN(applicationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const application = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      title: true,
      meals: { select: { mealKind: true, method: true, exemptionSelectable: true } },
    },
  });
  if (!application) {
    return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
  }

  const registrationRows = await prisma.mealRegistration.findMany({
    where: {
      applicationId,
      status: "APPROVED",
      user: { role: "STUDENT", grade, classNum },
    },
    select: {
      id: true,
      createdAt: true,
      addedBy: true,
      signature: true,
      user: { select: { number: true, name: true } },
      meals: { select: { mealKind: true, applied: true, exempt: true } },
    },
    orderBy: { user: { number: "asc" } },
  });

  const regIds = registrationRows.map((r) => r.id);
  const dayCounts =
    regIds.length > 0
      ? await prisma.mealRegistrationMealDate.groupBy({
          by: ["registrationId", "mealKind"],
          where: { registrationId: { in: regIds } },
          _count: { date: true },
        })
      : [];
  const dayCountMap = new Map<string, number>();
  for (const row of dayCounts) {
    dayCountMap.set(`${row.registrationId}:${row.mealKind}`, row._count.date);
  }

  const registrations = registrationRows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    addedBy: r.addedBy,
    signature: r.signature,
    user: r.user,
    meals: r.meals.map((m) => ({
      mealKind: m.mealKind,
      applied: m.applied,
      exempt: m.exempt,
      dayCount: dayCountMap.get(`${r.id}:${m.mealKind}`) ?? 0,
    })),
  }));

  return NextResponse.json({ application, registrations });
}
