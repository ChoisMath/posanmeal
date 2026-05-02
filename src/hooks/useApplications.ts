import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface MealApplicationItem {
  id: number;
  title: string;
  description: string | null;
  type: string;
  applyStart: string;
  applyEnd: string;
  mealStart: string | null;
  mealEnd: string | null;
  status: string;
  allowedDates?: Array<{ date: string }>;
  registrations: Array<{
    id: number;
    status: string;
    createdAt: string;
    selectedDates?: Array<{ date: string }>;
  }>;
}

export function useApplications() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/applications",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  );
  return {
    applications: (data?.applications ?? []) as MealApplicationItem[],
    error,
    isLoading,
    mutate,
  };
}
