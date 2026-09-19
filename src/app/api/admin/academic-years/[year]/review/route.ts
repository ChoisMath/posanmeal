import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { reviewRollover } from "@/lib/academic-year/rollover-service";

function parseYear(raw: string): number {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return year;
}

/** 전체 대조는 검토 메타데이터를 남기므로 조회가 아니라 POST다. */
export async function POST(_request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    await requireAcademicReady(prisma);

    const year = parseYear((await params).year);
    const review = await reviewRollover(prisma, actor, year);

    return NextResponse.json({ review });
  });
}
