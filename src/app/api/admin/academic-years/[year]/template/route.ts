import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { exportRoster } from "@/lib/academic-year/export-service";
import { requireActor } from "@/lib/academic-year/request-actor";

const yearParamSchema = z.coerce.number().int().min(2000).max(2100);

const flagSchema = z
  .enum(["0", "1", "true", "false"])
  .optional()
  .default("0")
  .transform((value) => value === "1" || value === "true");

const querySchema = z.object({
  includeData: flagSchema,
  includeCurrent: flagSchema,
});

function parseYear(raw: string): number {
  const parsed = yearParamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return parsed.data;
}

export async function GET(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("READ_ADMIN");

    const year = parseYear((await params).year);
    const searchParams = new URL(request.url).searchParams;
    const parsedQuery = querySchema.safeParse({
      includeData: searchParams.get("includeData") ?? undefined,
      includeCurrent: searchParams.get("includeCurrent") ?? undefined,
    });
    if (!parsedQuery.success) {
      throw new DomainError("MISSING_PROFILE", "includeData/includeCurrent 값을 확인하세요.");
    }
    const { includeData, includeCurrent } = parsedQuery.data;

    const buffer = await exportRoster(prisma, actor, year, includeData, includeCurrent);

    const filename = includeData ? `${year}_학년도_명부.xlsx` : `${year}_학년도_명부_양식.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  });
}
