import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deleteArchivedRoster } from "@/lib/academic-year/archive-service";
import { parseYearParam, payloadHash, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireAcademicReady } from "@/lib/academic-year/readiness";
import { requireActor } from "@/lib/academic-year/request-actor";
import { listRosterView, userIdsWithoutRecord } from "@/lib/academic-year/roster-service";

const flagSchema = z
  .enum(["0", "1", "true", "false"])
  .optional()
  .default("0")
  .transform((value) => value === "1" || value === "true");

const querySchema = z.object({
  includeExcluded: flagSchema,
  includeEntryless: flagSchema,
});

export async function GET(request: Request, { params }: { params: Promise<{ year: string }> }) {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");
    await requireAcademicReady(prisma);

    const year = parseYearParam((await params).year);
    const searchParams = new URL(request.url).searchParams;
    const roleParam = searchParams.get("role");
    if (roleParam !== null && roleParam !== "STUDENT" && roleParam !== "TEACHER") {
      throw new DomainError("INVALID_INPUT", "역할은 학생 또는 교사여야 합니다.");
    }

    const parsedQuery = querySchema.safeParse({
      includeExcluded: searchParams.get("includeExcluded") ?? undefined,
      includeEntryless: searchParams.get("includeEntryless") ?? undefined,
    });
    if (!parsedQuery.success) {
      throw new DomainError("INVALID_INPUT", "includeExcluded/includeEntryless 값을 확인하세요.");
    }

    const [rows, missingProfileUserIds] = await Promise.all([
      listRosterView(prisma, year, roleParam ?? undefined, parsedQuery.data),
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

    const year = parseYearParam((await params).year);

    const parsed = deleteBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("INVALID_INPUT", "요청 본문을 확인하세요.");
    }

    // 같은 선택을 순서만 다르게 보내도 같은 요청으로 재전송 판정되도록, 해시를
    // 계산하기 전에 중복 제거·정렬로 정규화한다. 서비스에 넘기는 값도 이 정규화된
    // 배열이다 — 해시가 보는 것과 실제로 쓰는 것이 갈라지면 안 된다.
    const entryIds =
      parsed.data.entryIds === "ALL" ? "ALL" : [...new Set(parsed.data.entryIds)].sort();

    const receipt = await deleteArchivedRoster(prisma, {
      actor,
      requestId: parsed.data.requestId,
      expectedVersion: parsed.data.expectedVersion,
      kind: "ARCHIVE_DELETE",
      payloadHash: payloadHash({ year, entryIds }),
      year,
      entryIds,
    });

    return NextResponse.json({ receipt });
  });
}
