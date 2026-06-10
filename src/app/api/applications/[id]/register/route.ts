import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { studentRegisterSchema } from "@/lib/schemas/meal-plan";
import { resolveRegistrationSelections, writeRegistration } from "@/lib/meal-plan-server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (Number.isNaN(applicationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = studentRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }
  const input = parsed.data;

  const now = new Date();
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (
    !app ||
    app.status !== "OPEN" ||
    !app.applyStartAt ||
    !app.applyEndAt ||
    now < app.applyStartAt ||
    now > app.applyEndAt
  ) {
    return NextResponse.json({ error: "신청 기간이 아닙니다." }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { role: true, grade: true },
  });

  if (!dbUser || dbUser.role !== "STUDENT" || dbUser.grade == null) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const resolveResult = await resolveRegistrationSelections(
    applicationId,
    dbUser.grade,
    input.meals,
  );

  if (!resolveResult.ok) {
    return NextResponse.json({ error: resolveResult.error }, { status: 400 });
  }

  const { registrationId, created } = await prisma.$transaction((tx) =>
    writeRegistration(tx, applicationId, session.user.dbUserId, input.signature, resolveResult.resolved),
  );

  return NextResponse.json({ registration: { id: registrationId } }, { status: created ? 201 : 200 });
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

  const now = new Date();
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (
    !app ||
    app.status !== "OPEN" ||
    !app.applyStartAt ||
    !app.applyEndAt ||
    now < app.applyStartAt ||
    now > app.applyEndAt
  ) {
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
