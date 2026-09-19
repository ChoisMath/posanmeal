import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { assertActor } from "./access";
import type { MutationInput, MutationReceipt, MutationSummary, Profile, RosterRow } from "./contracts";
import { DomainError } from "./errors";
import { withAcademicMutation } from "./mutation";
import { normalizeEmail, parseProfile } from "./profile-schema";
import { requireAcademicReady } from "./readiness";
import { readYearState, writeRosterProfiles } from "./roster-service";
import {
  DELETE_ARCHIVED_ROSTER_ALL_SQL,
  DELETE_ARCHIVED_ROSTER_SELECTED_SQL,
  DELETE_YEAR_ROSTER_FILES_SQL,
  CLEAR_YEAR_ROSTER_IMPORTS_SQL,
  OWNED_ROSTER_ENTRY_IDS_SQL,
} from "./roster-write-sql";

type Summary = MutationSummary & Prisma.InputJsonObject;

interface DeletedEntryRow {
  id: string;
  userId: number | null;
}

export type DeleteArchivedRosterInput = MutationInput & {
  year: number;
  entryIds: string[] | "ALL";
};

/**
 * 보관(ARCHIVED) 학년도의 `RosterEntry`만 지운다. 그 학년도의 `UserAcademicRecord`
 * (과거 명부 보존 기록)·`User`·신청·체크인·안면 프로필은 절대 건드리지 않는다.
 * `"ALL"`일 때만 같은 트랜잭션에서 그 학년도의 `RosterFile`을 지우고
 * `RosterImport.payload/preview`를 비운다(spec §4.4) — 선택 삭제는 사본을
 * 30일 보존 정리(`retention.ts`)에 맡긴다.
 */
export async function deleteArchivedRoster(
  db: PrismaClient,
  input: DeleteArchivedRosterInput,
): Promise<MutationReceipt> {
  const { receipt } = await withAcademicMutation(
    db,
    input,
    async (tx) => {
      await requireAcademicReady(tx);
      await assertActor(tx, input.actor, "MAIN");
    },
    async (tx): Promise<Summary> => {
      const state = await readYearState(tx, input.year);
      if (state !== "ARCHIVED") {
        throw new DomainError("YEAR_MISMATCH", "보관(지난) 학년도만 명부를 삭제할 수 있습니다.");
      }

      let deleted: DeletedEntryRow[];

      if (input.entryIds === "ALL") {
        deleted = await tx.$queryRawUnsafe<DeletedEntryRow[]>(
          DELETE_ARCHIVED_ROSTER_ALL_SQL,
          input.year,
        );
        await tx.$executeRawUnsafe(DELETE_YEAR_ROSTER_FILES_SQL, input.year);
        await tx.$executeRawUnsafe(CLEAR_YEAR_ROSTER_IMPORTS_SQL, input.year);
      } else {
        const uniqueIds = [...new Set(input.entryIds)];
        const owned = await tx.$queryRawUnsafe<{ id: string }[]>(
          OWNED_ROSTER_ENTRY_IDS_SQL,
          input.year,
          uniqueIds,
        );
        if (owned.length !== uniqueIds.length) {
          throw new DomainError(
            "YEAR_MISMATCH",
            "선택한 명부 항목 중 이 학년도에 속하지 않는 항목이 있습니다.",
          );
        }

        deleted = await tx.$queryRawUnsafe<DeletedEntryRow[]>(
          DELETE_ARCHIVED_ROSTER_SELECTED_SQL,
          input.year,
          uniqueIds,
        );
      }

      const userIds = [
        ...new Set(deleted.map((row) => row.userId).filter((id): id is number => id !== null)),
      ];
      return { changed: deleted.length, ids: userIds, year: input.year };
    },
  );

  return receipt;
}

export type CorrectAcademicRecordInput = MutationInput & {
  year: number;
  userId: number;
  profile: Profile;
};

/**
 * 명부 항목이 지워졌어도 보존된 `UserAcademicRecord`만 정정한다. `User`나 다른
 * 연도는 손대지 않고, `RosterEntry`도 새로 만들지 않는다. Task 5의
 * `writeRosterProfiles`를 그대로 다시 쓴다 — 확정 연도 쓰기는 ACTIVE일 때만
 * `RosterEntry`를 upsert하므로(그 외에는 건드리지 않으므로) 보관 연도 호출은
 * 항목을 되살리지 않는다. 대상 기록이 없으면 그 안에서 새로 만들지 않고 거절한다.
 */
export async function correctAcademicRecord(
  db: PrismaClient,
  input: CorrectAcademicRecordInput,
): Promise<MutationReceipt> {
  const profile = parseProfile(input.profile);

  const { receipt } = await withAcademicMutation(
    db,
    input,
    async (tx) => {
      await requireAcademicReady(tx);
      await assertActor(tx, input.actor, "WRITE_ADMIN");
    },
    async (tx): Promise<Summary> => {
      const state = await readYearState(tx, input.year);
      if (state !== "ARCHIVED") {
        throw new DomainError("YEAR_MISMATCH", "정정은 보관(지난) 학년도의 기록만 할 수 있습니다.");
      }

      const account = await tx.user.findUnique({
        where: { id: input.userId },
        select: { email: true, emailKey: true },
      });
      if (!account) {
        throw new DomainError("MISSING_PROFILE", "대상 사용자를 찾을 수 없습니다.");
      }

      const row: RosterRow = {
        entryId: randomUUID(),
        userId: input.userId,
        email: account.email,
        emailKey: account.emailKey ?? normalizeEmail(account.email),
        profile,
        baseUserVersion: null,
        included: true,
      };

      const summary = await writeRosterProfiles(tx, input.year, [row]);
      return { ...summary, year: input.year };
    },
  );

  return receipt;
}
