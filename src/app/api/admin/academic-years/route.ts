import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { createDraftYear } from "@/lib/academic-year/roster-service";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  year: z.number().int().min(2000).max(2100),
  sourceYear: z.number().int().min(2000).max(2100).optional(),
});

export async function GET() {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");
    await requireAcademicReady(prisma);

    const [years, control] = await Promise.all([
      prisma.academicYear.findMany({
        select: { year: true, state: true, version: true, activatedAt: true },
        orderBy: { year: "desc" },
      }),
      prisma.rosterControl.findUniqueOrThrow({ where: { id: 1 } }),
    ]);

    return NextResponse.json({ years, controlVersion: control.version });
  });
}

export async function POST(request: Request) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    await requireAcademicReady(prisma);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("YEAR_MISMATCH", "학년도와 명부 버전을 확인하세요.");
    }
    const { requestId, expectedVersion, year, sourceYear } = parsed.data;

    const receipt = await createDraftYear(prisma, {
      actor,
      requestId,
      expectedVersion,
      kind: "CREATE_DRAFT_YEAR",
      payloadHash: payloadHash({ year, sourceYear: sourceYear ?? null }),
      year,
      sourceYear,
    });

    return NextResponse.json({ receipt }, { status: 201 });
  });
}
