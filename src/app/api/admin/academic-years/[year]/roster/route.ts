import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deleteArchivedRoster } from "@/lib/academic-year/archive-service";
import { payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { listRosterView, userIdsWithoutRecord } from "@/lib/academic-year/roster-service";

function parseYear(raw: string): number {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return year;
}

export async function GET(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");
    await requireAcademicReady(prisma);

    const year = parseYear((await params).year);
    const roleParam = new URL(request.url).searchParams.get("role");
    if (roleParam !== null && roleParam !== "STUDENT" && roleParam !== "TEACHER") {
      throw new DomainError("MISSING_PROFILE", "역할은 학생 또는 교사여야 합니다.");
    }

    const [rows, missingProfileUserIds] = await Promise.all([
      listRosterView(prisma, year, roleParam ?? undefined),
      userIdsWithoutRecord(prisma, year),
    ]);

    return NextResponse.json({ year, rows, missingProfileUserIds });
  });
}

const deleteBodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  entryIds: z.union([z.literal("ALL"), z.array(z.string().min(1).max(64)).max(10_000)]),
});

export async function DELETE(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("MAIN");
    await requireAcademicReady(prisma);

    const year = parseYear((await params).year);

    const parsed = deleteBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("INVALID_INPUT", "요청 본문을 확인하세요.");
    }

    const receipt = await deleteArchivedRoster(prisma, {
      actor,
      requestId: parsed.data.requestId,
      expectedVersion: parsed.data.expectedVersion,
      kind: "ARCHIVE_DELETE",
      payloadHash: payloadHash({ year, entryIds: parsed.data.entryIds }),
      year,
      entryIds: parsed.data.entryIds,
    });

    return NextResponse.json({ receipt });
  });
}
