import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseIdParam, payloadHash, routeResponse } from "@/lib/academic-year/api";
import { changeEmail } from "@/lib/academic-year/account-service";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor } from "@/lib/academic-year/request-actor";

const bodySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedRowVersion: z.number().int().nonnegative(),
  email: z.string().email().max(254),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const userId = parseIdParam((await params).id);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError("MISSING_PROFILE", "이메일 형식과 버전을 확인하세요.");
    }
    const { requestId, expectedRowVersion, email } = parsed.data;

    const receipt = await changeEmail(prisma, {
      actor,
      requestId,
      userId,
      expectedRowVersion,
      kind: "EMAIL",
      payloadHash: payloadHash({ userId, email: email.trim() }),
      email,
    });

    return NextResponse.json({ receipt });
  });
}
