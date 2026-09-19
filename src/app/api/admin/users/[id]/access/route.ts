import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseIdParam, payloadHash, routeResponse } from "@/lib/academic-year/api";
import { changeAccess } from "@/lib/academic-year/account-service";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor } from "@/lib/academic-year/request-actor";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedRowVersion: z.number().int().nonnegative(),
  state: z.enum(["ACTIVE", "INACTIVE"]),
  reason: z.string().min(1).max(100),
  confirmPrivileges: z.boolean().default(false),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return routeResponse(async () => {
    // 재개는 메인 관리자만 할 수 있고, 그 판정은 changeAccess가 트랜잭션 안에서 다시 한다.
    const actor = await requireActor("WRITE_ADMIN");
    const userId = parseIdParam((await params).id);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("MISSING_PROFILE", "이용 상태와 사유를 확인하세요.");
    }
    const { requestId, expectedRowVersion, state, reason, confirmPrivileges } = parsed.data;

    const receipt = await changeAccess(prisma, {
      actor,
      requestId,
      userId,
      expectedRowVersion,
      kind: "ACCESS",
      payloadHash: payloadHash({ userId, state, reason }),
      state,
      reason,
      confirmPrivileges,
    });

    return NextResponse.json({ receipt });
  });
}
