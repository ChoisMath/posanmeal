import type { LocalUser } from "@/lib/local-db";

export interface LocalCheckInRow {
  id: number;
  userId: number;
  userLabel: string;
  name: string;
  date: string;
  mealKind: "BREAKFAST" | "DINNER";
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
  if (errorMessage) {
    return <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">동기화되지 않은 데이터가 없습니다</p>;
  }
  // Full table markup added in Task 4
  return <p className="text-sm">{rows.length}건</p>;
}
