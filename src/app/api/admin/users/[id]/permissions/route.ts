import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseIdParam, payloadHash, routeResponse } from "@/lib/academic-year/api";
import { changePermissions } from "@/lib/academic-year/account-service";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor } from "@/lib/academic-year/request-actor";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedRowVersion: z.number().int().nonnegative(),
  level: z.enum(["NONE", "SUBADMIN", "ADMIN"]),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("MAIN");
    const userId = parseIdParam((await params).id);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("MISSING_PROFILE", "권한 등급과 버전을 확인하세요.");
    }
    const { requestId, expectedRowVersion, level } = parsed.data;

    const receipt = await changePermissions(prisma, {
      actor,
      requestId,
      userId,
      expectedRowVersion,
      kind: "PERMISSIONS",
      payloadHash: payloadHash({ userId, level }),
      level,
    });

    return NextResponse.json({ receipt });
  });
}
