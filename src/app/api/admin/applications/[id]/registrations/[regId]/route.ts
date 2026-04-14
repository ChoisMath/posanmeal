import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { regId } = await params;
  const { status } = await request.json();
  if (status !== "APPROVED" && status !== "CANCELLED") {
    return NextResponse.json({ error: "잘못된 상태값입니다." }, { status: 400 });
  }

  const data: Record<string, unknown> = { status };
  if (status === "CANCELLED") {
    data.cancelledAt = new Date();
    data.cancelledBy = "ADMIN";
  } else {
    data.cancelledAt = null;
    data.cancelledBy = null;
  }

  const registration = await prisma.mealRegistration.update({
    where: { id: parseInt(regId) },
    data,
  });
  return NextResponse.json({ registration });
}
