import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { previewRosterImport } from "@/lib/academic-year/import-service";
import { requireActor } from "@/lib/academic-year/request-actor";
import { purgeExpiredRosterCopies } from "@/lib/academic-year/retention";

const yearParamSchema = z.coerce.number().int().min(2000).max(2100);
const scopeSchema = z.enum(["PARTIAL", "FULL"]);

function parseYear(raw: string): number {
  const parsed = yearParamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return parsed.data;
}

function maxFileSizeMb(): number {
  const parsed = Number.parseInt(process.env.MAX_FILE_SIZE_MB ?? "5", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

export async function POST(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const year = parseYear((await params).year);

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      throw new DomainError("INVALID_FILE", "파일이 필요합니다.");
    }

    const scope = scopeSchema.safeParse(form?.get("scope"));
    if (!scope.success) {
      throw new DomainError("MISSING_PROFILE", "반영 범위는 PARTIAL 또는 FULL이어야 합니다.");
    }

    // 파싱 전에 크기를 끊는다. 큰 워크북은 읽는 동안 메모리를 그만큼 차지한다.
    const limitMb = maxFileSizeMb();
    if (file.size > limitMb * 1024 * 1024) {
      return NextResponse.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: `파일이 너무 큽니다. 최대 ${limitMb}MB까지 올릴 수 있습니다.`,
          },
        },
        { status: 413 },
      );
    }

    const preview = await previewRosterImport(prisma, actor, year, scope.data, await file.arrayBuffer());

    await purgeExpiredRosterCopies(prisma, new Date());

    return NextResponse.json({ preview });
  });
}
