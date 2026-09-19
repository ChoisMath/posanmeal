import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { commitRosterImport, IMPORT_MUTATION_KIND } from "@/lib/academic-year/import-service";
import { requireActor } from "@/lib/academic-year/request-actor";

const yearParamSchema = z.coerce.number().int().min(2000).max(2100);

/** 확정 본문은 행 값을 담지 않는다. 무엇을 쓸지는 서버에 보관된 미리보기가 정한다. */
const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  confirmedNewRowTokens: z.array(z.string().min(1).max(64)).max(5000).default([]),
  omissionsConfirmed: z.boolean().default(false),
});

function parseYear(raw: string): number {
  const parsed = yearParamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return parsed.data;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ year: string; id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");

    const resolved = await params;
    const year = parseYear(resolved.year);
    const importId = resolved.id;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("MISSING_PROFILE", "요청 본문을 확인하세요.");
    }

    const confirmedNewRowTokens = [...new Set(parsed.data.confirmedNewRowTokens)].sort();

    const receipt = await commitRosterImport(prisma, {
      actor,
      requestId: parsed.data.requestId,
      expectedVersion: parsed.data.expectedVersion,
      kind: IMPORT_MUTATION_KIND,
      payloadHash: payloadHash({
        importId,
        year,
        actor,
        confirmedNewRowTokens,
        omissionsConfirmed: parsed.data.omissionsConfirmed,
      }),
      importId,
      year,
      confirmedNewRowTokens,
      omissionsConfirmed: parsed.data.omissionsConfirmed,
    });

    return NextResponse.json({ receipt });
  });
}
