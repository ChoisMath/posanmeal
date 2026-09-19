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

function tooLarge(limitMb: number): NextResponse {
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

export async function POST(request: Request, { params }: { params: Promise<{ year: string }> }) {
  try {
    return await routeResponse(async () => {
      const actor = await requireActor("WRITE_ADMIN");
      const year = parseYear((await params).year);

      // 본문을 버퍼에 올리기 전에 먼저 끊는다. Content-Length가 없거나 거짓이면
      // 아래 file.size 검사가 같은 한도로 다시 막는다.
      const limitMb = maxFileSizeMb();
      const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
      if (Number.isInteger(declared) && declared > limitMb * 1024 * 1024) {
        return tooLarge(limitMb);
      }

      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) {
        throw new DomainError("INVALID_FILE", "파일이 필요합니다.");
      }

      const scope = scopeSchema.safeParse(form?.get("scope"));
      if (!scope.success) {
        throw new DomainError("MISSING_PROFILE", "반영 범위는 PARTIAL 또는 FULL이어야 합니다.");
      }

      // 워크북 파싱 전에 실제 크기로 다시 끊는다.
      if (file.size > limitMb * 1024 * 1024) {
        return tooLarge(limitMb);
      }

      const preview = await previewRosterImport(prisma, actor, year, scope.data, await file.arrayBuffer());
      return NextResponse.json({ preview });
    });
  } finally {
    // 실패한 업로드도 정리의 기회다. 이 호출은 절대 응답을 바꾸지 않는다.
    await purgeExpiredRosterCopies(prisma, new Date());
  }
}
