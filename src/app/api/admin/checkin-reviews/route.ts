import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { displayNameOf, getReportProfilesByYear, MISSING_PROFILE_WARNING } from "@/lib/academic-year/report-profile";
import { checkInReviewPayload } from "@/lib/admin-roster/checkin-review";

const STATES = new Set(["PENDING", "ACCEPTED", "DUPLICATE", "REJECTED"]);
const MAX_ROWS = 200;

export async function GET(request: Request) {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");
    await requireAcademicReady(prisma);

    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    const id = params.get("id");
    const rows = await prisma.localCheckInReview.findMany({
      where: { ...(state && STATES.has(state) ? { state } : {}), ...(id ? { id } : {}) },
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

    const parsed = rows.map((row) => ({ row, payload: checkInReviewPayload(row.payload) }));
    const idsByYear = new Map<number, Set<number>>();
    for (const { payload } of parsed) {
      if (payload.userId === null || payload.year === null) continue;
      const ids = idsByYear.get(payload.year) ?? new Set<number>();
      ids.add(payload.userId);
      idsByYear.set(payload.year, ids);
    }
    const profiles = await getReportProfilesByYear(prisma, idsByYear, false);
    const reviews = parsed.map(({ row, payload }) => {
      if (payload.userId === null || payload.year === null) return { ...row, subject: null };
      const report = profiles.get(payload.year)?.get(payload.userId);
      const profile = report?.historical;
      const affiliation = !profile ? MISSING_PROFILE_WARNING : profile.role === "STUDENT"
        ? `${profile.grade ?? "—"}학년 ${profile.classNum ?? "—"}반 ${profile.number ?? "—"}번`
        : ["교사", profile.subject, profile.homeroom, profile.position].filter(Boolean).join(" · ");
      return { ...row, subject: { name: displayNameOf(report), year: payload.year, affiliation,
        warning: report?.warning ?? null } };
    });
    return NextResponse.json({ reviews });
  });
}
