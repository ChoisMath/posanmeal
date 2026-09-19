import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";

const STATES = new Set(["PENDING", "ACCEPTED", "DUPLICATE", "REJECTED"]);
const MAX_ROWS = 200;

export async function GET(request: Request) {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");
    await requireAcademicReady(prisma);

    const state = new URL(request.url).searchParams.get("state");
    const rows = await prisma.localCheckInReview.findMany({
      where: state && STATES.has(state) ? { state } : {},
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true,
        clientKey: true,
        snapshotId: true,
        reason: true,
        state: true,
        payload: true,
        decision: true,
        createdAt: true,
        resolvedAt: true,
      },
    });

    return NextResponse.json({ reviews: rows });
  });
}
