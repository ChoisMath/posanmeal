import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const registrations = await prisma.mealRegistration.findMany({
    where: { userId: session.user.dbUserId },
    include: {
      application: {
        select: {
          id: true, title: true, type: true, description: true,
          applyStart: true, applyEnd: true, mealStart: true, mealEnd: true, status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ registrations });
}
