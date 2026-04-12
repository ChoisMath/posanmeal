import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> }
) {
  const { regId } = await params;
  const { status } = await request.json();

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
