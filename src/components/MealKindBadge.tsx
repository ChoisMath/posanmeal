import { Badge } from "@/components/ui/badge";
import { MEAL_LABEL, type MealKind } from "@/lib/meal-plan";

const BADGE_CLASS: Record<MealKind, string> = {
  BREAKFAST: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  LUNCH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  DINNER: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

export function MealKindBadge({ mealKind }: { mealKind: MealKind }) {
  return (
    <Badge variant="secondary" className={BADGE_CLASS[mealKind]}>
      {MEAL_LABEL[mealKind]}
    </Badge>
  );
}
