"use client";

import { useMemo } from "react";
import type { LocalUser, StoredLocalCheckIn } from "@/lib/local-db";
import { formatDateTimeSecondsKST } from "@/lib/timezone";
import { Info } from "lucide-react";
import { MEAL_SHORT } from "@/lib/meal-plan";

export interface LocalCheckInRow {
  id: number;
  userId: number;
  userLabel: string;
  name: string;
  date: string;
  /** v6 이전 기록에는 식사 구분이 없을 수 있다. 지어내지 않고 그대로 비워 둔다. */
  mealKind?: "BREAKFAST" | "LUNCH" | "DINNER";
  type: "STUDENT" | "WORK" | "PERSONAL";
  checkedAt: string;
  status: LocalCheckInStatus;
  reason?: string;
  snapshotId?: string;
  deviceId?: string;
  sourceJson?: string;
}

export type LocalCheckInStatus = "미전송" | "검토 대기" | "거절 확정";

export function localCheckInStatus(record: StoredLocalCheckIn): LocalCheckInStatus {
  if (record.terminal === "REJECTED") return "거절 확정";
  return record.reviewId === undefined ? "미전송" : "검토 대기";
}

export function toLocalCheckInRow(
  record: StoredLocalCheckIn,
  user: LocalUser | undefined,
): LocalCheckInRow {
  const displayUser = record.displayProfile !== undefined
    ? record.displayProfile ?? undefined
    : record.snapshotId ? undefined : user;
  return {
    id: record.id!,
    userId: record.userId,
    userLabel: buildUserLabel(displayUser, record.userId),
    name: displayUser?.name ?? "-",
    date: record.date,
    mealKind: record.mealKind,
    type: record.type,
    checkedAt: record.checkedAt,
    status: localCheckInStatus(record),
    reason: record.reviewReason,
    snapshotId: record.snapshotId,
    deviceId: record.deviceId,
    sourceJson: JSON.stringify(record),
  };
}

export function buildUserLabel(u: LocalUser | undefined, userId: number): string {
  if (!u) return `id:${userId}`;
  if (u.role === "TEACHER") return "교사";
  if (u.grade && u.classNum && u.number) {
    return `${u.grade}-${u.classNum}-${u.number}`;
  }
  return u.name;
}

interface LocalCheckInsTableProps {
  rows: LocalCheckInRow[];
  loading: boolean;
  errorMessage: string | null;
}

export function LocalCheckInsTable({ rows, loading, errorMessage }: LocalCheckInsTableProps) {
  const missingUserCount = useMemo(
    () => rows.filter((r) => r.userLabel.startsWith("id:")).length,
    [rows],
  );

  if (errorMessage) {
    return <p className="text-sm text-red-600 dark:text-red-400 break-keep">{errorMessage}</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">동기화되지 않은 데이터가 없습니다</p>;
  }

  return (
    <>
      <p className="text-sm text-muted-foreground mb-2 break-keep">
        {rows.filter((r) => r.status !== "거절 확정").length}건이 아직 서버에 반영되지 않았고,
        {" "}{rows.filter((r) => r.status === "거절 확정").length}건은 거절로 종결되었습니다.
      </p>
      {missingUserCount > 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1 break-keep">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          {missingUserCount}건은 사용자 정보 매핑 실패
        </p>
      )}
      <div className="overflow-x-auto border rounded-lg max-h-[60dvh]">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-background z-10">
            <tr className="border-b">
              <th className="sticky left-0 z-[1] bg-background px-3 py-2 text-left font-medium">학년반번호</th>
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-left font-medium">날짜</th>
              <th className="px-3 py-2 text-left font-medium">식사</th>
              <th className="px-3 py-2 text-left font-medium">종류</th>
              <th className="px-3 py-2 text-left font-medium">체크시각</th>
              <th className="px-3 py-2 text-left font-medium">상태</th>
              <th className="px-3 py-2 text-left font-medium">사유</th>
              <th className="px-3 py-2 text-left font-medium">ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="sticky left-0 z-[1] bg-background px-3 py-2">{r.userLabel}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.mealKind === undefined ? "-" : MEAL_SHORT[r.mealKind]}</td>
                <td className="px-3 py-2">{r.type}</td>
                <td className="px-3 py-2">{Number.isNaN(Date.parse(r.checkedAt)) ? "시각 확인 필요" : formatDateTimeSecondsKST(new Date(r.checkedAt)).slice(11)}</td>
                <td className={`px-3 py-2 ${r.status === "거절 확정" ? "text-red-600 dark:text-red-400" : ""}`}>{r.status}</td>
                <td className="px-3 py-2 text-muted-foreground" title={r.reason}>{r.reason ?? "-"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
