import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import { requireActor } from "@/lib/academic-year/request-actor";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const applicationId = parseIdParam((await params).id);

    const application = await withEligibilityMutation(
      prisma,
      actor,
      { scope: "APPLICATION", applicationId },
      (tx) => tx.mealApplication.update({ where: { id: applicationId }, data: { status: "CLOSED" } }),
    );

    return NextResponse.json({ application });
  });
}
