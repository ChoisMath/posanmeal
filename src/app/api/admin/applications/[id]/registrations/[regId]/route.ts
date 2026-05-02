import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import { patchRegistrationDatesSchema } from "@/lib/schemas/application";

function dateFromKey(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, regId } = await params;
  const applicationId = parseInt(id, 10);
  const registrationId = parseInt(regId, 10);
  const body = await request.json();

  if ("status" in body) {
    if (body.status !== "APPROVED" && body.status !== "CANCELLED") {
      return NextResponse.json({ error: "잘못된 상태값입니다." }, { status: 400 });
    }

    const data: Record<string, unknown> = { status: body.status };
    if (body.status === "CANCELLED") {
      data.cancelledAt = new Date();
      data.cancelledBy = "ADMIN";
    } else {
      data.cancelledAt = null;
      data.cancelledBy = null;
    }

    const registration = await prisma.mealRegistration.update({
      where: { id: registrationId },
      data,
      include: { selectedDates: { orderBy: { date: "asc" } } },
    });
    return NextResponse.json({ registration });
  }

  const parsed = patchRegistrationDatesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "추가 또는 제거할 날짜가 필요합니다.", errorCode: "INVALID_DATES" },
      { status: 400 },
    );
  }

  const app = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    include: { allowedDates: true },
  });
  if (!app || app.type !== "BREAKFAST") {
    return NextResponse.json({ error: "조식 공고에서만 날짜를 수정할 수 있습니다." }, { status: 400 });
  }

  const allowed = new Set(app.allowedDates.map((d) => d.date.toISOString().slice(0, 10)));
  const addDates = Array.from(new Set(parsed.data.addDates ?? []));
  const removeDates = Array.from(new Set(parsed.data.removeDates ?? []));

  if (addDates.some((date) => !allowed.has(date)) || removeDates.some((date) => !allowed.has(date))) {
    return NextResponse.json(
      { error: "선택할 수 없는 조식 날짜가 포함되어 있습니다.", errorCode: "INVALID_DATES" },
      { status: 400 },
    );
  }

  const registration = await prisma.$transaction(async (tx) => {
    if (removeDates.length > 0) {
      await tx.mealRegistrationDate.deleteMany({
        where: {
          registrationId,
          date: { in: removeDates.map(dateFromKey) },
        },
      });
    }
    if (addDates.length > 0) {
      await tx.mealRegistrationDate.createMany({
        data: addDates.map((date) => ({ registrationId, date: dateFromKey(date) })),
        skipDuplicates: true,
      });
    }
    await tx.mealRegistration.update({
      where: { id: registrationId },
      data: { updatedAt: new Date() },
    });
    return tx.mealRegistration.findUnique({
      where: { id: registrationId },
      include: { selectedDates: { orderBy: { date: "asc" } } },
    });
  });

  return NextResponse.json({ registration });
}
