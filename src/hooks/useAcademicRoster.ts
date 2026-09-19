"use client";

import useSWR from "swr";
import type { YearState } from "@/lib/academic-year/contracts";
import { fetcher } from "@/lib/fetcher";

export type AcademicYearRow = {
  year: number;
  state: YearState;
  version: number;
  activatedAt: string | null;
};

export type RosterViewRow = {
  entryId: string;
  userId: number | null;
  email: string;
  emailKey: string;
  profile: {
    role: "STUDENT" | "TEACHER";
    name: string;
    grade: number | null;
    classNum: number | null;
    number: number | null;
    gender: "MALE" | "FEMALE" | null;
    subject: string | null;
    homeroom: string | null;
    position: string | null;
  };
  baseUserVersion: number | null;
  included: boolean;
  version: number;
  needsReview: boolean;
  memberState: string | null;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN" | null;
  accessState: string | null;
  incomplete: boolean;
  issues: Array<{ field: string; message: string }>;
};

export type LegacyAdminUser = {
  id: number;
  email: string;
  name: string;
  role: "STUDENT" | "TEACHER";
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
  accessState: string;
  profileVersion: number;
};

type FetchError = Error & { status?: number; info?: unknown };

/** 503 NOT_READY는 오류가 아니라 "아직 준비 중"이다. 화면은 조용히 옛 목록만 보여 준다. */
export function isNotReady(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as FetchError).status;
  if (status !== 503) return false;
  const info = (error as FetchError).info;
  if (typeof info !== "object" || info === null) return true;
  const code = (info as { error?: { code?: unknown } }).error?.code;
  return code === undefined || code === "NOT_READY";
}

const swrOptions = { revalidateOnFocus: false, shouldRetryOnError: false } as const;

export function useAcademicYears() {
  const { data, error, isLoading, mutate } = useSWR<{
    years: AcademicYearRow[];
    controlVersion: number;
  }>("/api/admin/academic-years", fetcher, swrOptions);

  const years = data?.years ?? [];
  return {
    years,
    activeYear: years.find((year) => year.state === "ACTIVE") ?? null,
    controlVersion: data?.controlVersion ?? null,
    notReady: isNotReady(error),
    error: isNotReady(error) ? undefined : error,
    isLoading,
    mutate,
  };
}

export function useRoster(
  year: number | null,
  role: "STUDENT" | "TEACHER",
  options?: { includeExcluded?: boolean; includeEntryless?: boolean },
) {
  const query = new URLSearchParams({ role });
  if (options?.includeExcluded) query.set("includeExcluded", "1");
  if (options?.includeEntryless) query.set("includeEntryless", "1");

  const key = year === null ? null : `/api/admin/academic-years/${year}/roster?${query.toString()}`;
  const { data, error, isLoading, mutate } = useSWR<{
    year: number;
    rows: RosterViewRow[];
    missingProfileUserIds: number[];
  }>(key, fetcher, swrOptions);

  return {
    rows: data?.rows ?? [],
    missingProfileUserIds: data?.missingProfileUserIds ?? [],
    notReady: isNotReady(error),
    error: isNotReady(error) ? undefined : error,
    isLoading,
    mutate,
  };
}

/** 계정 변경(이메일·이용 상태·권한)이 쓰는 버전과 상태의 출처. */
export function useAccountRows(role: "STUDENT" | "TEACHER") {
  const { data, error, isLoading, mutate } = useSWR<{ users: LegacyAdminUser[] }>(
    `/api/admin/users?role=${role}`,
    fetcher,
    swrOptions,
  );

  const byId = new Map<number, LegacyAdminUser>();
  for (const user of data?.users ?? []) byId.set(user.id, user);

  return { accounts: byId, error, isLoading, mutate };
}
