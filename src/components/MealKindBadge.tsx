import { Badge } from "@/components/ui/badge";

export function MealKindBadge({ mealKind }: { mealKind: "BREAKFAST" | "DINNER" }) {
  return (
    <Badge
      variant="secondary"
      className={
        mealKind === "BREAKFAST"
          ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      }
    >
      {mealKind === "BREAKFAST" ? "조식" : "석식"}
    </Badge>
  );
}
