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

export function useTeacherStudents(year: number, month: number) {
  const { data, error, isLoading } = useSWR(
    `/api/teacher/students?year=${year}&month=${month}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    students: (data?.students ?? []) as Student[],
    mealColumns: (data?.mealColumns ?? []) as MealColumn[],
    grade: data?.grade as number | undefined,
    classNum: data?.classNum as number | undefined,
    error,
    isLoading,
  };
}
