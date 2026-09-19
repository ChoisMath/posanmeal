import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { cancelRosterImport, resolveImportConflicts } from "@/lib/academic-year/import-service";
import { requireActor } from "@/lib/academic-year/request-actor";

const bodySchema = z.object({
  choices: z
    .array(
      z.object({
        token: z.string().min(1).max(64),
        resolution: z.enum(["USE_FILE", "KEEP_SERVER"]),
      }),
    )
    .max(5000),
});

function parseImportId(raw: string): string {
  if (raw.length === 0 || raw.length > 64) {
    throw new DomainError("MISSING_PROFILE", "미리보기를 찾을 수 없습니다.");
  }
  return raw;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ year: string; id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const importId = parseImportId((await params).id);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("MISSING_PROFILE", "요청 본문을 확인하세요.");
    }

    const preview = await resolveImportConflicts(prisma, actor, importId, parsed.data.choices);
    return NextResponse.json({ preview });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ year: string; id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const importId = parseImportId((await params).id);

    await cancelRosterImport(prisma, actor, importId);
    return NextResponse.json({ cancelled: true });
  });
}
