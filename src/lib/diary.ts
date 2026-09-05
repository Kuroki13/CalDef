import "server-only";

/**
 * Diary reads.
 *
 * Everything here is scoped by RLS rather than by an explicit `user_id`
 * filter — the policies key on `auth.uid()`, so a query that forgot to
 * filter returns nothing rather than someone else's data. The filters that
 * do appear are for correctness of the *result*, not for authorization.
 */

import { type IsoDate } from "@/lib/dates";
import { getFavoriteFoodIds } from "@/lib/favorites";
import {
  type MacroTotals,
  ZERO_MACROS,
} from "@/lib/nutrition/macros";
import { type DayTotals, totalsForDay } from "@/lib/nutrition/totals";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type MealType = Pick<
  Tables<"meal_types">,
  "id" | "slug" | "name" | "sort_order"
>;

export type DiaryEntry = MacroTotals & {
  id: number;
  meal_type_id: number;
  amount: number;
  unit: "g" | "ml" | "serving";
  grams: number;
  source: string;
  notes: string | null;
  foodName: string;
  foodBrand: string | null;
  servingLabel: string | null;
  /** Null for a recipe-backed entry, which has no single food to star. */
  foodId: number | null;
  isFavorite: boolean;
};

export type DiaryDay = {
  date: IsoDate;
  entries: DiaryEntry[];
  totals: DayTotals;
  mealTypes: MealType[];
};

/** Built-in meals (`user_id is null`) plus the user's own, in display order. */
export async function getMealTypes(): Promise<MealType[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("meal_types")
    .select("id, slug, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** One day's entries, joined to the food that produced them. */
export async function getDiaryDay(date: IsoDate): Promise<DiaryDay> {
  const supabase = await createClient();

  const [entriesResult, mealTypes, favoriteIds] = await Promise.all([
    supabase
      .from("food_logs")
      .select(
        `id, meal_type_id, food_id, amount, unit, grams, kcal, protein_g,
         carbs_g, fat_g, source, notes, created_at,
         foods ( name, brand ),
         food_servings ( label )`,
      )
      .eq("log_date", date)
      .order("created_at", { ascending: true }),
    getMealTypes(),
    getFavoriteFoodIds(),
  ]);

  if (entriesResult.error) throw new Error(entriesResult.error.message);

  const entries: DiaryEntry[] = (entriesResult.data ?? []).map((row) => ({
    id: row.id,
    meal_type_id: row.meal_type_id,
    amount: Number(row.amount),
    unit: row.unit as DiaryEntry["unit"],
    grams: Number(row.grams),
    kcal: Number(row.kcal),
    protein_g: Number(row.protein_g),
    carbs_g: Number(row.carbs_g),
    fat_g: Number(row.fat_g),
    source: row.source,
    notes: row.notes,
    // A recipe-backed entry has no `foods` row; the name falls back to the
    // note rather than rendering blank.
    foodName: row.foods?.name ?? row.notes ?? "Logged item",
    foodBrand: row.foods?.brand ?? null,
    servingLabel: row.food_servings?.label ?? null,
    foodId: row.food_id,
    isFavorite: row.food_id !== null && favoriteIds.has(row.food_id),
  }));

  return {
    date,
    entries,
    totals: totalsForDay(entries),
    mealTypes,
  };
}

/** Daily totals across a span, for the expenditure model and the charts. */
export async function getDailyTotals(
  from: IsoDate,
  to: IsoDate,
): Promise<Map<IsoDate, MacroTotals>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("food_logs")
    .select("log_date, kcal, protein_g, carbs_g, fat_g")
    .gte("log_date", from)
    .lte("log_date", to);

  if (error) throw new Error(error.message);

  const byDate = new Map<IsoDate, MacroTotals>();
  for (const row of data ?? []) {
    const current = byDate.get(row.log_date) ?? { ...ZERO_MACROS };
    byDate.set(row.log_date, {
      kcal: round2(current.kcal + Number(row.kcal)),
      protein_g: round2(current.protein_g + Number(row.protein_g)),
      carbs_g: round2(current.carbs_g + Number(row.carbs_g)),
      fat_g: round2(current.fat_g + Number(row.fat_g)),
    });
  }

  return byDate;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
