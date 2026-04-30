import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "STUDENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id);
  const { signature } = await request.json();

  if (!signature) {
    return NextResponse.json({ error: "서명이 필요합니다." }, { status: 400 });
  }
  if (signature.length > 200_000) {
    return NextResponse.json({ error: "서명 데이터가 너무 큽니다." }, { status: 400 });
  }

  const today = new Date(todayKST());
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (!app || app.status !== "OPEN" || today < app.applyStart || today > app.applyEnd) {
    return NextResponse.json({ error: "신청 기간이 아닙니다." }, { status: 400 });
  }

  try {
    const existing = await prisma.mealRegistration.findUnique({
      where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
    });

    if (existing?.status === "APPROVED") {
      return NextResponse.json({ error: "이미 신청되었습니다." }, { status: 409 });
    }

    const registration = existing
      ? await prisma.mealRegistration.update({
          where: { id: existing.id },
          data: {
            status: "APPROVED",
            signature,
            cancelledAt: null,
            cancelledBy: null,
          },
        })
      : await prisma.mealRegistration.create({
          data: { applicationId, userId: session.user.dbUserId, signature },
        });

    return NextResponse.json({ registration }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 신청되었습니다." }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id);

  const today = new Date(todayKST());
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (!app || today < app.applyStart || today > app.applyEnd) {
    return NextResponse.json({ error: "신청 취소 기간이 아닙니다." }, { status: 400 });
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
