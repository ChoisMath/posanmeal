import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { DECISION_MUTATION_KIND, saveRolloverDecision } from "@/lib/academic-year/rollover-service";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  userId: z.number().int().positive(),
  decision: z.enum(["GRADUATED", "TRANSFERRED", "RETIRED", "RESTORE"]),
});

function parseYear(raw: string): number {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return year;
}

async function save(request: Request, params: Promise<{ year: string }>) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    await requireAcademicReady(prisma);

    const year = parseYear((await params).year);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("MISSING_PROFILE", "대상과 결정을 확인하세요.");
    }
    const { requestId, expectedVersion, userId, decision } = parsed.data;

    const receipt = await saveRolloverDecision(prisma, {
      actor,
      requestId,
      expectedVersion,
      kind: DECISION_MUTATION_KIND,
      payloadHash: payloadHash({ year, userId, decision }),
      year,
      userId,
      decision,
    });

    return NextResponse.json({ receipt });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return save(request, params);
}

export async function PUT(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return save(request, params);
}
