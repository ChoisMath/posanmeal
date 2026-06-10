import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { MealKind, MealApplyMethod } from "@/lib/meal-plan";

export interface ApplicationListItem {
  id: number;
  title: string;
  description: string | null;
  applyStartAt: string;
  applyEndAt: string;
  meals: Array<{
    mealKind: MealKind;
    price: number;
    method: MealApplyMethod;
    exemptionSelectable: boolean;
  }>;
  myStatus: "NONE" | "APPLIED" | "CANCELLED";
}

export function useApplications() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/applications",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    },
  );
  return {
    applications: (data?.applications ?? []) as ApplicationListItem[],
    error,
    isLoading,
    mutate,
  };
}
