import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface CheckInRecord {
  id: number;
  date: string;
  checkedAt: string;
  type: string;
}

export function useCheckins(year: number, month: number) {
  const { data, error, isLoading } = useSWR(
    `/api/checkins?year=${year}&month=${month}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    checkIns: (data?.checkIns ?? []) as CheckInRecord[],
    error,
    isLoading,
  };
}
