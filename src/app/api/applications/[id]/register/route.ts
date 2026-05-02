import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { validateSelectedDates } from "@/lib/breakfast-validation";
import {
  breakfastRegistrationSchema,
  dinnerRegistrationSchema,
} from "@/lib/schemas/application";

function dateFromKey(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "STUDENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  const body = await request.json();

  const today = new Date(todayKST());
  const app = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    include: { allowedDates: { orderBy: { date: "asc" } } },
  });

  if (!app || app.status !== "OPEN" || today < app.applyStart || today > app.applyEnd) {
    return NextResponse.json(
      { error: "신청 기간이 아닙니다.", errorCode: "OUT_OF_APPLY_WINDOW" },
      { status: 400 },
    );
  }

  if (app.type === "BREAKFAST") {
    const parsed = breakfastRegistrationSchema.safeParse(body);
    if (!parsed.success || parsed.data.signature.length > 200_000) {
      return NextResponse.json(
        { error: "서명과 신청 날짜를 확인해 주세요.", errorCode: "RESIGN_REQUIRED" },
        { status: 400 },
      );
    }

    const allowedDates = app.allowedDates.map((date) => date.date.toISOString().slice(0, 10));
    const valid = validateSelectedDates(parsed.data.selectedDates, allowedDates);
    if (!valid.ok) {
      return NextResponse.json(
        { error: "선택할 수 없는 조식 날짜가 포함되어 있습니다.", errorCode: "INVALID_DATES" },
        { status: 400 },
      );
    }

    const existing = await prisma.mealRegistration.findUnique({
      where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
    });

    const registration = await prisma.$transaction(async (tx) => {
      const parent = existing
        ? await tx.mealRegistration.update({
            where: { id: existing.id },
            data: {
              status: "APPROVED",
              signature: parsed.data.signature,
              cancelledAt: null,
              cancelledBy: null,
            },
          })
        : await tx.mealRegistration.create({
            data: {
              applicationId,
              userId: session.user.dbUserId,
              signature: parsed.data.signature,
            },
          });

      await tx.mealRegistrationDate.deleteMany({
        where: { registrationId: parent.id },
      });
      await tx.mealRegistrationDate.createMany({
        data: valid.dates.map((date) => ({
          registrationId: parent.id,
          date: dateFromKey(date),
        })),
        skipDuplicates: true,
      });

      return tx.mealRegistration.findUnique({
        where: { id: parent.id },
        include: { selectedDates: { orderBy: { date: "asc" } } },
      });
    });

    return NextResponse.json({ registration }, { status: existing ? 200 : 201 });
  }

  const parsed = dinnerRegistrationSchema.safeParse(body);
  if (!parsed.success || parsed.data.signature.length > 200_000) {
    return NextResponse.json({ error: "서명이 필요합니다." }, { status: 400 });
  }

  try {
    const existing = await prisma.mealRegistration.findUnique({
      where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
    });

    if (existing?.status === "APPROVED") {
      return NextResponse.json({ error: "이미 신청하였습니다." }, { status: 409 });
    }

    const registration = existing
      ? await prisma.mealRegistration.update({
          where: { id: existing.id },
          data: {
            status: "APPROVED",
            signature: parsed.data.signature,
            cancelledAt: null,
            cancelledBy: null,
          },
        })
      : await prisma.mealRegistration.create({
          data: { applicationId, userId: session.user.dbUserId, signature: parsed.data.signature },
        });

    return NextResponse.json({ registration }, { status: existing ? 200 : 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 신청하였습니다." }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);

  const today = new Date(todayKST());
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (!app || today < app.applyStart || today > app.applyEnd) {
    return NextResponse.json(
      { error: "신청 취소 기간이 아닙니다.", errorCode: "OUT_OF_APPLY_WINDOW" },
      { status: 400 },
    );
  }

  const reg = await prisma.mealRegistration.findUnique({
    where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
  });

  if (!reg || reg.status !== "APPROVED") {
    return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });
  }

  await prisma.mealRegistration.update({
    where: { id: reg.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "STUDENT" },
  });

  return NextResponse.json({ success: true });
}
