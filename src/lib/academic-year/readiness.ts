import type { PrismaClient } from "@/generated/prisma/client";
import { LEGACY_FINGERPRINT_FORMAT, LEGACY_FINGERPRINT_VERSION } from "../../../scripts/academic-year/fingerprint";
import { assertActor } from "./access";
import { ACADEMIC_BACKFILL_KEY, checkCurrentBackfill, lockBackfillVerificationSources } from "./backfill";
import type { Actor } from "./contracts";
import type { Db, Tx } from "./db";
import { DomainError } from "./errors";
import { ROSTER_TX, withAcademicMutation } from "./mutation";
import { invalidateRosterModeCache } from "./roster-mode-cache";

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
  const source = manifest as Record<string, unknown>;
  const issues = source.issues;
  if (!Array.isArray(issues) || issues.some((value) => typeof value !== "string")) return ["MANIFEST_UNREADABLE:1"];
  if (source.fingerprintFormat !== LEGACY_FINGERPRINT_FORMAT || source.fingerprintVersion !== LEGACY_FINGERPRINT_VERSION) {
    return [...issues, "FINGERPRINT_FORMAT_MISMATCH:1"];
  }
  return issues;
}

export type AcademicReadiness = { mode: string; canEnable: boolean; issues: string[] };

async function currentReadiness(db: Db): Promise<AcademicReadiness> {
  const { mode } = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
  if (mode === "READY") return { mode, canEnable: false, issues: [] };
  const { backfill, issues } = await checkCurrentBackfill(db);
  if (!backfill || backfill.state !== "VERIFIED" || backfill.verifiedAt === null) issues.push("BACKFILL_NOT_VERIFIED:1");
  if (backfill) issues.push(...readIssues(backfill.sourceManifest));
  const uniqueIssues = [...new Set(issues)].sort();
  return { mode, canEnable: uniqueIssues.length === 0, issues: uniqueIssues };
}

export async function inspectAcademicMode(db: PrismaClient): Promise<AcademicReadiness> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return currentReadiness(tx);
  }, { ...ROSTER_TX, isolationLevel: "RepeatableRead" });
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
    (tx: Tx) => assertActor(tx, actor, "MAIN"),
    async (tx: Tx) => {
      await lockBackfillVerificationSources(tx);
      const readiness = await currentReadiness(tx);
      if (readiness.mode === "READY") return { changed: 0, ids: [1] };
      if (!readiness.canEnable) {
        throw new DomainError("NOT_READY", "초기 이전 검증이 끝나야 학년도 기능을 켤 수 있습니다.");
      }

      await tx.rosterControl.update({ where: { id: 1 }, data: { mode: "READY" } });
      return { changed: 1, ids: [1] };
    },
  );

  // 현재 프로세스만 무효화한다. 별도 CLI로 전환하면 앱 인스턴스는 재시작 또는 TTL 만료가 필요하다.
  invalidateRosterModeCache();
}
