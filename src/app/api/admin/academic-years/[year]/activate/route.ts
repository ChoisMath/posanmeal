import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseYearParam, payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { ACTIVATE_MUTATION_KIND, activateAcademicYear } from "@/lib/academic-year/rollover-service";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  yearVersion: z.number().int().nonnegative(),
  sourceVersion: z.number().int().nonnegative(),
  kiosksPaused: z.boolean(),
  warningsAcknowledged: z.boolean(),
});

export async function POST(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("MAIN");
    await requireAcademicReady(prisma);

    const year = parseYearParam((await params).year);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("INVALID_INPUT", "전환에 필요한 확인 항목을 모두 보내세요.");
    }
    const body = parsed.data;

    const receipt = await activateAcademicYear(prisma, {
      actor,
      requestId: body.requestId,
      expectedVersion: body.expectedVersion,
      kind: ACTIVATE_MUTATION_KIND,
      payloadHash: payloadHash({
        year,
        yearVersion: body.yearVersion,
        sourceVersion: body.sourceVersion,
        kiosksPaused: body.kiosksPaused,
        warningsAcknowledged: body.warningsAcknowledged,
      }),
      year,
      yearVersion: body.yearVersion,
      sourceVersion: body.sourceVersion,
      kiosksPaused: body.kiosksPaused,
      warningsAcknowledged: body.warningsAcknowledged,
    });

    return NextResponse.json({ receipt });
  });
}
