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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);
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
    const allowedDateObjects = allowedDates.map(dateFromKey);
    const overlap = await prisma.mealApplicationDate.findFirst({
      where: {
        date: { in: allowedDateObjects },
        application: {
          id: { not: applicationId },
          type: "BREAKFAST",
          status: "OPEN",
        },
      },
    });
    if (overlap) {
      return NextResponse.json(
        { error: "다른 진행 중인 조식 공고와 날짜가 겹칩니다.", errorCode: "OVERLAPPING_DATES" },
        { status: 409 },
      );
    }

    const affectedRegistrations = await prisma.mealRegistration.count({
      where: {
        applicationId,
        status: "APPROVED",
        selectedDates: { some: { date: { notIn: allowedDateObjects } } },
      },
    });

    const application = await prisma.$transaction(async (tx) => {
      await tx.mealApplicationDate.deleteMany({ where: { applicationId } });
      await tx.mealRegistrationDate.deleteMany({
        where: {
          registration: { applicationId },
          date: { notIn: allowedDateObjects },
        },
      });

      return tx.mealApplication.update({
        where: { id: applicationId },
        data: {
          title: body.title,
          description: body.description || null,
          type: "BREAKFAST",
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
    });

    return NextResponse.json({ application, affectedRegistrations });
  }

  const application = await prisma.$transaction(async (tx) => {
    await tx.mealApplicationDate.deleteMany({ where: { applicationId } });
    await tx.mealRegistrationDate.deleteMany({
      where: { registration: { applicationId } },
    });

    return tx.mealApplication.update({
      where: { id: applicationId },
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
  });

  return NextResponse.json({ application, affectedRegistrations: 0 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  await prisma.mealApplication.delete({ where: { id: parseInt(id, 10) } });
  return NextResponse.json({ success: true });
}
