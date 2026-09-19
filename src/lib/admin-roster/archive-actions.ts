import type { Profile } from "@/lib/academic-year/contracts";
import { rosterProfileWith, type ProfileField } from "./profile-edit";
import { newRequestId } from "./request-id";

export type ArchiveDeleteAttempt = {
  key: string;
  count: number;
  body: { requestId: string; expectedVersion: number; entryIds: string[] | "ALL" };
};

export function archiveDeleteAttempt(
  previous: ArchiveDeleteAttempt | null,
  year: number,
  version: number,
  entryIds: string[] | "ALL",
  count: number,
  generate = newRequestId,
): ArchiveDeleteAttempt {
  const normalized = entryIds === "ALL" ? "ALL" : [...new Set(entryIds)].sort();
  const key = JSON.stringify({ year, entryIds: normalized });
  if (previous?.key === key) return previous;
  return { key, count, body: { requestId: generate(), expectedVersion: version, entryIds: normalized } };
}

export type ArchivedCorrectionAttempt = {
  key: string;
  body: { requestId: string; expectedRowVersion: number; email: string; profile: Profile };
};

export function archivedCorrectionAttempt(
  previous: ArchivedCorrectionAttempt | null,
  year: number,
  row: { userId: number; version: number; email: string; profile: Profile },
  field: ProfileField,
  next: string,
  generate = newRequestId,
): ArchivedCorrectionAttempt {
  const key = JSON.stringify({ year, userId: row.userId, field, next });
  if (previous?.key === key) return previous;
  return {
    key,
    body: {
      requestId: generate(),
      expectedRowVersion: row.version,
      email: row.email,
      profile: rosterProfileWith(row.profile, field, next),
    },
  };
}
