import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { exportRoster } from "@/lib/academic-year/export-service";
import { requireActor } from "@/lib/academic-year/request-actor";

function parseYear(raw: string): number {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError("YEAR_MISMATCH", "학년도를 확인하세요.");
  }
  return year;
}

function parseBooleanParam(value: string | null): boolean {
  return value === "1" || value === "true";
}

export async function GET(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("READ_ADMIN");

    const year = parseYear((await params).year);
    const searchParams = new URL(request.url).searchParams;
    const includeData = parseBooleanParam(searchParams.get("includeData"));
    const includeCurrent = parseBooleanParam(searchParams.get("includeCurrent"));

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
