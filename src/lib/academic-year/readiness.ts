import type { PrismaClient } from "@/generated/prisma/client";
import { ACADEMIC_BACKFILL_KEY } from "./backfill";
import type { Actor } from "./contracts";
import type { Db, Tx } from "./db";
import { DomainError } from "./errors";
import { withAcademicMutation } from "./mutation";

const ENABLE_REQUEST_ID = `enable-academic-${ACADEMIC_BACKFILL_KEY}`;

/**
 * 새 학년도 기능 API(명부·Excel·전환·검토) 전용 가드. PREPARING 동안에는
 * 이 경로만 막고, 기존 사용자 관리·신청·체크인 쓰기는 막지 않는다.
 */
export async function requireAcademicReady(db: Db): Promise<void> {
  const rows = await db.$queryRaw<{ mode: string }[]>`SELECT mode FROM "RosterControl" WHERE id = 1`;
  if (rows[0]?.mode !== "READY") {
    throw new DomainError("NOT_READY", "학년도 명부 기능을 준비 중입니다. 잠시 후 다시 시도하세요.");
  }
}

function readIssues(manifest: unknown): string[] {
  if (typeof manifest !== "object" || manifest === null) return ["MANIFEST_UNREADABLE:1"];
  const issues = (manifest as Record<string, unknown>).issues;
  if (!Array.isArray(issues)) return ["MANIFEST_UNREADABLE:1"];
  return issues.filter((value): value is string => typeof value === "string");
}

/**
 * 메인 관리자만 PREPARING → READY로 넘긴다. 초기 이전이 VERIFIED이고 남은
 * 충돌이 없을 때만 허용한다.
 */
export async function enableAcademicMode(db: PrismaClient, actor: Actor): Promise<void> {
  const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });

  await withAcademicMutation(
    db,
    {
      actor,
      requestId: ENABLE_REQUEST_ID,
      expectedVersion: control.version,
      kind: "ENABLE_ACADEMIC_MODE",
      payloadHash: ACADEMIC_BACKFILL_KEY,
    },
    async () => {
      // Task 4에서 assertActor(tx, actor, "MAIN")로 교체할 자리.
      if (actor.kind !== "MAIN") {
        throw new DomainError("FORBIDDEN", "메인 관리자만 학년도 기능을 활성화할 수 있습니다.");
      }
    },
    async (tx: Tx) => {
      const backfill = await tx.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } });
      if (!backfill || backfill.state !== "VERIFIED" || readIssues(backfill.sourceManifest).length > 0) {
        throw new DomainError("NOT_READY", "초기 이전 검증이 끝나야 학년도 기능을 켤 수 있습니다.");
      }

      await tx.rosterControl.update({ where: { id: 1 }, data: { mode: "READY" } });
      return { changed: 1, ids: [1] };
    },
  );
}
