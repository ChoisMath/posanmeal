import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { MealColumn, MealKind } from "@/lib/meal-columns";

interface Student {
  id: number;
  name: string;
  number: number;
  photoUrl: string | null;
  checkIns: { date: string; checkedAt: string; type: string; mealKind: MealKind | null }[];
  appliedDates: { date: string; mealKind: MealKind }[];
  qrString: string;
}

export function useTeacherStudents(period: { year: number; month: number } | null) {
  const { data, error, isLoading, mutate } = useSWR(
    period ? `/api/teacher/students?year=${period.year}&month=${period.month}` : "/api/teacher/students",
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    students: (data?.students ?? []) as Student[],
    mealColumns: (data?.mealColumns ?? []) as MealColumn[],
    grade: data?.grade as number | undefined,
    classNum: data?.classNum as number | undefined,
    academicYear: data?.academicYear as number | undefined,
    year: data?.year as number | undefined,
    month: data?.month as number | undefined,
    error,
    isLoading,
    mutate,
  };
}
