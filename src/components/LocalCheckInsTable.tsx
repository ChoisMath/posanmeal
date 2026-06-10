"use client";

import { useMemo } from "react";
import type { LocalUser } from "@/lib/local-db";
import { formatDateTimeSecondsKST } from "@/lib/timezone";
import { Info } from "lucide-react";

export interface LocalCheckInRow {
  id: number;
  userId: number;
  userLabel: string;
  name: string;
  date: string;
  mealKind: "BREAKFAST" | "LUNCH" | "DINNER";
  type: "STUDENT" | "WORK" | "PERSONAL";
  checkedAt: string;
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
    return <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">동기화되지 않은 데이터가 없습니다</p>;
  }

  return (
    <>
      <p className="text-sm text-muted-foreground mb-2">
        {rows.length}건의 체크인이 아직 서버로 전송되지 않았습니다.
      </p>
      {missingUserCount > 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          {missingUserCount}건은 사용자 정보 매핑 실패
        </p>
      )}
      <div className="overflow-x-auto border rounded-lg max-h-[60vh]">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-background z-10">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">학년반번호</th>
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-left font-medium">날짜</th>
              <th className="px-3 py-2 text-left font-medium">식사</th>
              <th className="px-3 py-2 text-left font-medium">종류</th>
              <th className="px-3 py-2 text-left font-medium">체크시각</th>
              <th className="px-3 py-2 text-left font-medium">ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">{r.userLabel}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.mealKind === "BREAKFAST" ? "조" : "석"}</td>
                <td className="px-3 py-2">{r.type}</td>
                <td className="px-3 py-2">{formatDateTimeSecondsKST(new Date(r.checkedAt)).slice(11)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
