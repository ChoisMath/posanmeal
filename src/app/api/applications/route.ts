import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toDateKey } from "@/lib/meal-plan-server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const applications = await prisma.mealApplication.findMany({
    where: {
      status: "OPEN",
      applyStartAt: { lte: now },
      applyEndAt: { gte: now },
    },
    include: {
      meals: true,
      registrations: {
        where: { userId: session.user.dbUserId },
        select: { id: true, status: true },
      },
    },
    orderBy: { applyEndAt: "asc" },
  });

  const result = applications.map((app) => {
    const reg = app.registrations[0];
    let myStatus: "NONE" | "APPLIED" | "CANCELLED" = "NONE";
    if (reg) {
      myStatus = reg.status === "CANCELLED" ? "CANCELLED" : "APPLIED";
    }

    return {
      id: app.id,
      title: app.title,
      description: app.description,
      applyStartAt: app.applyStartAt,
      applyEndAt: app.applyEndAt,
      meals: app.meals
        .filter((m) => m.method !== "NONE")
        .map((m) => ({
          mealKind: m.mealKind,
          price: m.price,
          method: m.method,
          exemptionSelectable: m.exemptionSelectable,
        })),
      myStatus,
    };
  });

  return NextResponse.json({ applications: result });
}
