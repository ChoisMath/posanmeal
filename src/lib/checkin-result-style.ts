export type CheckInCategory = "success" | "duplicate" | "notApplicant" | "error";

export interface CategorizableResult {
  success: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
}

export function resultCategory(r: CategorizableResult): CheckInCategory {
  if (r.success) return "success";
  if (r.duplicate) return "duplicate";
  if (r.notApplicant) return "notApplicant";
  return "error";
}

export const RESULT_BG_CLASS: Record<CheckInCategory, string> = {
  success: "bg-emerald-500",
  duplicate: "bg-blue-500",
  notApplicant: "bg-red-500",
  error: "bg-orange-500",
};

export const RESULT_TEXT_CLASS: Record<CheckInCategory, string> = {
  success: "text-emerald-700 dark:text-emerald-300",
  duplicate: "text-blue-700 dark:text-blue-300",
  notApplicant: "text-red-700 dark:text-red-300",
  error: "text-orange-800 dark:text-orange-200",
};
