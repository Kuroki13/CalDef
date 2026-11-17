/**
 * Which meal "Add food" should start on when nobody said.
 *
 * By the clock, on the device — the only place that knows the user's hour
 * for certain — and only for today: for another day the hour says nothing,
 * and the meal stays whatever the user chose. It is a starting point shown
 * in the open, never a choice made behind the user's back: the adding tool
 * names the meal at the top and it can be changed with one tap.
 */

type Meal = { id: number; slug: string | null };

export function mealForHour<T extends Meal>(meals: readonly T[], hour: number): T | null {
  const slug =
    hour >= 4 && hour < 11
      ? "breakfast"
      : hour >= 11 && hour < 15
        ? "lunch"
        : hour >= 18 && hour < 23
          ? "dinner"
          : "snack";
  return meals.find((meal) => meal.slug === slug) ?? meals[0] ?? null;
}
