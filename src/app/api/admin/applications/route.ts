import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import { applicationSchema } from "@/lib/schemas/application";

function dateFromKey(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function uniqSortedDates(dates: string[]) {
  return Array.from(new Set(dates)).sort();
}

export async function GET() {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [applications, cancelledCounts] = await Promise.all([
    prisma.mealApplication.findMany({
      include: {
        allowedDates: { orderBy: { date: "asc" } },
        _count: {
          select: {
            registrations: { where: { status: "APPROVED" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mealRegistration.groupBy({
      by: ["applicationId"],
      where: { status: "CANCELLED" },
      _count: true,
    }),
  ]);

  const cancelledMap = new Map(
    cancelledCounts.map((c) => [c.applicationId, c._count])
  );

  const applicationIds = applications.map((app) => app.id);
  const registrationDates = applicationIds.length
    ? await prisma.mealRegistrationDate.findMany({
        where: {
          registration: {
            applicationId: { in: applicationIds },
            status: "APPROVED",
          },
        },
        select: {
          date: true,
          registration: { select: { applicationId: true } },
        },
      })
    : [];
  const dailyCountMap = new Map<number, Record<string, number>>();
  for (const item of registrationDates) {
    const applicationId = item.registration.applicationId;
    const key = item.date.toISOString().slice(0, 10);
    const counts = dailyCountMap.get(applicationId) ?? {};
    counts[key] = (counts[key] ?? 0) + 1;
    dailyCountMap.set(applicationId, counts);
  }

  const appsWithCounts = applications.map((app) => ({
    ...app,
    allowedDatesCount: app.allowedDates.length,
    dailyCounts: dailyCountMap.get(app.id) ?? {},
    cancelledCount: cancelledMap.get(app.id) || 0,
  }));

  return NextResponse.json({ applications: appsWithCounts });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = applicationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const body = parsed.data;
  if (body.type === "BREAKFAST") {
    const allowedDates = uniqSortedDates(body.allowedDates);
    const overlap = await prisma.mealApplicationDate.findFirst({
      where: {
        date: { in: allowedDates.map(dateFromKey) },
        application: { type: "BREAKFAST", status: "OPEN" },
      },
    });
    if (overlap) {
      return NextResponse.json(
        { error: "다른 진행 중인 조식 공고와 날짜가 겹칩니다.", errorCode: "OVERLAPPING_DATES" },
        { status: 409 },
      );
    }

    const application = await prisma.mealApplication.create({
      data: {
        title: body.title,
        description: body.description || null,
        type: body.type,
        applyStart: dateFromKey(body.applyStart),
        applyEnd: dateFromKey(body.applyEnd),
        mealStart: dateFromKey(allowedDates[0]),
        mealEnd: dateFromKey(allowedDates[allowedDates.length - 1]),
        allowedDates: {
          create: allowedDates.map((date) => ({ date: dateFromKey(date) })),
        },
      },
      include: { allowedDates: { orderBy: { date: "asc" } } },
    });
    return NextResponse.json({ application }, { status: 201 });
  }

  const application = await prisma.mealApplication.create({
    data: {
      title: body.title,
      description: body.description || null,
      type: body.type,
      applyStart: dateFromKey(body.applyStart),
      applyEnd: dateFromKey(body.applyEnd),
      mealStart: body.type === "DINNER" ? dateFromKey(body.mealStart) : null,
      mealEnd: body.type === "DINNER" ? dateFromKey(body.mealEnd) : null,
    },
  });
  return NextResponse.json({ application }, { status: 201 });
}
