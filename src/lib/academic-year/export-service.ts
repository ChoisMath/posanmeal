import { randomUUID } from "node:crypto";
import { assertActor } from "./access";
import type { Actor } from "./contracts";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "./db";
import { requireAcademicReady } from "./readiness";
import { purgeExpiredRosterCopies } from "./retention";
import { activeYear, listRosterView, readYearState } from "./roster-service";
import { getAcademicProfiles } from "./profile-service";
import { buildRosterWorkbook, WORKBOOK_SCHEMA_VERSION, type WorkbookManifest } from "./workbook";
import type { RosterRow } from "./contracts";

/**
 * ARCHIVED 학년도는 보존 정리로 `RosterEntry`가 지워졌을 수 있다. 그 경우
 * `UserAcademicRecord`만 남아 있어도 명부를 다시 만들어 내보내지 않는다 —
 * entryId가 없는 행(예전 스냅샷이 사라진 행)은 뺀다.
 */
async function exportableRows(db: Db, year: number): Promise<{ rows: (RosterRow & { version: number })[] }> {
  const state = await readYearState(db, year);
  const view = await listRosterView(db, year, undefined, { includeExcluded: state === "ARCHIVED" });

  const rows = view
    .filter((row) => state !== "ARCHIVED" || row.entryId.length > 0)
    .map((row) => ({
      entryId: row.entryId,
      userId: row.userId,
      email: row.email,
      emailKey: row.emailKey,
      profile: row.profile,
      baseUserVersion: row.baseUserVersion,
      included: row.included,
      version: row.version,
    }));

  return { rows };
}

/**
 * 다운로드마다 새 파일을 만든다. 서버 대응표(`RosterFile`)는 워크북 버퍼가
 * 성공적으로 만들어진 뒤에만 기록해, 빌드 실패가 짝 없는 행을 남기지 않는다.
 */
export async function exportRoster(
  db: PrismaClient,
  actor: Actor,
  year: number,
  includeData: boolean,
  includeCurrent: boolean,
): Promise<Buffer> {
  await assertActor(db, actor, "READ_ADMIN");
  await requireAcademicReady(db);

  const state = await readYearState(db, year);
  const { rows } = await exportableRows(db, year);
  const academicYear = await db.academicYear.findUniqueOrThrow({ where: { year }, select: { version: true } });

  const manifest: WorkbookManifest = {
    schemaVersion: WORKBOOK_SCHEMA_VERSION,
    fileId: includeData ? randomUUID() : "",
    year,
    version: academicYear.version,
    rows: {},
  };

  if (includeData) {
    for (const row of rows) {
      manifest.rows[randomUUID()] = {
        entryId: row.entryId,
        userId: row.userId,
        email: row.email,
        version: row.version,
      };
    }
  }

  let currentProfiles: Map<number, { grade: number | null; classNum: number | null; number: number | null }> | undefined;
  if (includeData && includeCurrent && state !== "ACTIVE") {
    const active = await activeYear(db);
    const userIds = rows.map((row) => row.userId).filter((id): id is number => id !== null);
    const profiles = await getAcademicProfiles(db, userIds, active);
    currentProfiles = new Map(
      [...profiles.entries()].map(([userId, profile]) => [
        userId,
        { grade: profile.grade, classNum: profile.classNum, number: profile.number },
      ]),
    );
  }

  const buffer = await buildRosterWorkbook({
    year,
    rows,
    includeData,
    manifest,
    currentProfiles,
  });

  if (includeData) {
    await db.rosterFile.create({
      data: {
        id: manifest.fileId,
        year,
        version: manifest.version,
        schemaVersion: manifest.schemaVersion,
        manifest: manifest as unknown as object,
      },
    });
  }

  await purgeExpiredRosterCopies(db, new Date());

  return buffer;
}
