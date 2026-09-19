import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { studentRegisterSchema } from "@/lib/schemas/meal-plan";
import { resolveRegistrationSelections, writeRegistration } from "@/lib/meal-plan-server";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import { getRegistrationContext } from "@/lib/academic-year/registration-context";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";
import type { Tx } from "@/lib/academic-year/db";

/** 접수 기간 밖이면 학생 경로에서는 신청도 취소도 받지 않는다. */
async function isApplyWindowOpen(tx: Tx, applicationId: number) {
  const app = await tx.mealApplication.findUnique({
    where: { id: applicationId },
    select: { status: true, applyStartAt: true, applyEndAt: true },
  });
  const now = new Date();
  return !!app && app.status === "OPEN" && !!app.applyStartAt && !!app.applyEndAt &&
    now >= app.applyStartAt && now <= app.applyEndAt;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("STUDENT");
    const userId = selfUserId(actor);
    const applicationId = parseIdParam((await params).id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" },
        { status: 400 },
      );
    }

    const parsed = studentRegisterSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const written = await withEligibilityMutation<
      { registrationId: number; created: boolean } | { error: string }
    >(
      prisma,
      actor,
      {
        scope: "REGISTRATION",
        applicationId,
        userId,
        recorded: (result) => !("error" in result),
      },
      async (tx) => {
        if (!(await isApplyWindowOpen(tx, applicationId))) return { error: "신청 기간이 아닙니다." };
        const existing = await tx.mealRegistration.findUnique({
          where: { applicationId_userId: { applicationId, userId } },
          select: { status: true },
        });
        const intent = existing?.status === "APPROVED" ? "EDIT" : existing ? "RESTORE" : "CREATE";

        const context = await getRegistrationContext(tx, actor, applicationId, userId, intent);
        const resolved = await resolveRegistrationSelections(
          applicationId,
          context.profile.grade ?? 0,
          input.meals,
          context.resolveContext,
        );
        if (!resolved.ok) return { error: resolved.error };

        return writeRegistration(tx, applicationId, userId, input.signature, resolved.resolved);
      },
    );

    if ("error" in written) {
      return NextResponse.json({ error: written.error }, { status: 400 });
    }

    return NextResponse.json(
      { registration: { id: written.registrationId } },
      { status: written.created ? 201 : 200 },
    );
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("STUDENT");
    const userId = selfUserId(actor);
    const applicationId = parseIdParam((await params).id);

    const cancelled = await withEligibilityMutation<boolean | { error: string; errorCode: string }>(
      prisma,
      actor,
      {
        scope: "REGISTRATION",
        applicationId,
        userId,
        recorded: (done) => done === true,
      },
      async (tx) => {
        if (!(await isApplyWindowOpen(tx, applicationId))) {
          return { error: "신청 취소 기간이 아닙니다.", errorCode: "OUT_OF_APPLY_WINDOW" };
        }
        const reg = await tx.mealRegistration.findUnique({
          where: { applicationId_userId: { applicationId, userId } },
        });
        if (!reg || reg.status !== "APPROVED") return false;

        await getRegistrationContext(tx, actor, applicationId, userId, "CANCEL");
        await tx.mealRegistration.update({
          where: { id: reg.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: "STUDENT",
          },
        });
        return true;
      },
    );

    if (typeof cancelled === "object") return NextResponse.json(cancelled, { status: 400 });
    if (!cancelled) {
      return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  });
}
