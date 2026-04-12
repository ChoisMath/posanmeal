import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface Student {
  id: number;
  name: string;
  number: number;
  photoUrl: string | null;
  checkIns: { date: string; checkedAt: string }[];
}

export function useTeacherStudents(year: number, month: number) {
  const { data, error, isLoading } = useSWR(
    `/api/teacher/students?year=${year}&month=${month}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    students: (data?.students ?? []) as Student[],
    grade: data?.grade as number | undefined,
    classNum: data?.classNum as number | undefined,
    error,
    isLoading,
  };
}
