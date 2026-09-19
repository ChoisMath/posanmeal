import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { correctAcademicRecord } from "@/lib/academic-year/archive-service";
import { parseIdParam, payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { parseProfile } from "@/lib/academic-year/profile-schema";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { readYearState, upsertRosterProfile } from "@/lib/academic-year/roster-service";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedRowVersion: z.number().int().nonnegative(),
  email: z.string().min(1).max(254),
  profile: z.unknown(),
  entryId: z.string().min(1).max(64).optional(),
});

function parseYear(raw: string): number {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return year;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ year: string; userId: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    await requireAcademicReady(prisma);

    const resolved = await params;
    const year = parseYear(resolved.year);
    const userId = parseIdParam(resolved.userId);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("MISSING_PROFILE", "요청 본문을 확인하세요.");
    }

    const email = parsed.data.email.trim();
    const profile = parseProfile(parsed.data.profile);

    // 어떤 함수로 보낼지만 여기서 고른다. 각 함수는 트랜잭션 안에서 학년도
    // 상태를 다시 읽고 스스로 검증한다 — 이 조회는 분기 선택용일 뿐이다.
    const state = await readYearState(prisma, year);

    const receipt =
      state === "ARCHIVED"
        ? await correctAcademicRecord(prisma, {
            actor,
            requestId: parsed.data.requestId,
            expectedRowVersion: parsed.data.expectedRowVersion,
            kind: "ROSTER_CORRECT",
            payloadHash: payloadHash({ year, userId, profile }),
            year,
            userId,
            profile,
          })
        : await upsertRosterProfile(prisma, {
            actor,
            requestId: parsed.data.requestId,
            expectedRowVersion: parsed.data.expectedRowVersion,
            kind: "ROSTER_ROW",
            payloadHash: payloadHash({ year, userId, email, profile }),
            year,
            userId,
            entryId: parsed.data.entryId,
            email,
            profile,
          });

    return NextResponse.json({ receipt });
  });
}
