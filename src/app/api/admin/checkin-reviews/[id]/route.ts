import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { resolveCheckInReview } from "@/lib/academic-year/upload-review";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  decision: z.enum(["ACCEPT", "REJECT"]),
  reason: z.string().min(1).max(200),
  mealKind: z.enum(["BREAKFAST", "LUNCH", "DINNER"]).optional(),
});

async function resolve(request: Request, params: Promise<{ id: string }>) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    await requireAcademicReady(prisma);

    const reviewId = (await params).id;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("INVALID_INPUT", "결정과 사유를 확인하세요.");
    }
    const { requestId, decision, reason, mealKind } = parsed.data;

    const receipt = await resolveCheckInReview(prisma, {
      actor,
      requestId,
      // 검토는 전역 명부 버전과 무관하다. 충돌은 검토 행의 상태로 판정한다.
      expectedVersion: 0,
      kind: "RESOLVE_CHECKIN_REVIEW",
      payloadHash: payloadHash({ reviewId, decision, reason, mealKind: mealKind ?? null }),
      reviewId,
      decision,
      reason,
      mealKind,
    });

    return NextResponse.json({ receipt });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return resolve(request, params);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return resolve(request, params);
}
