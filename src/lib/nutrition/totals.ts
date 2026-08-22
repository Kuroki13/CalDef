/**
 * Diary aggregation — folding logged entries into a day, a meal, or a span.
 *
 * Pure functions over plain values. The rows arriving here have already had
 * their nutrition computed by `macros.ts` at log time and stored on
 * `food_logs`, so this module only ever adds up numbers that already exist;
 * it never recomputes them from a food. That matters because a logged entry
 * is a historical record: if a provider later revises a food's nutrient row,
 * yesterday's diary must not silently change.
 */

import {
  type MacroTotals,
  ZERO_MACROS,
  addMacros,
  sumMacros,
} from "@/lib/nutrition/macros";

/** The subset of a `food_logs` row that aggregation needs. */
export type LoggedEntry = MacroTotals & {
  meal_type_id: number;
};

export type MealTotals = {
  meal_type_id: number;
  totals: MacroTotals;
  entryCount: number;
};

export type DayTotals = {
  totals: MacroTotals;
  byMeal: MealTotals[];
  entryCount: number;
};

/** Totals for one day, plus a per-meal breakdown in first-seen order. */
export function totalsForDay(entries: readonly LoggedEntry[]): DayTotals {
  const byMeal = new Map<number, MealTotals>();

  for (const entry of entries) {
    const existing = byMeal.get(entry.meal_type_id);
    if (existing) {
      existing.totals = addMacros(existing.totals, entry);
      existing.entryCount += 1;
    } else {
      byMeal.set(entry.meal_type_id, {
        meal_type_id: entry.meal_type_id,
        totals: { ...toMacros(entry) },
        entryCount: 1,
      });
    }
  }

  return {
    totals: sumMacros(entries.map(toMacros)),
    byMeal: [...byMeal.values()],
    entryCount: entries.length,
  };
}

export type Remaining = {
  /** Positive means calories still available; negative means over target. */
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Consumed / target, clamped to [0, 2] so a runaway day still renders. */
  kcalProgress: number;
  isOver: boolean;
};

/** What is left of a target after the day so far. */
export function remainingAgainstTarget(
  consumed: MacroTotals,
  target: MacroTotals,
): Remaining {
  const kcal = round2(target.kcal - consumed.kcal);
  const progress = target.kcal > 0 ? consumed.kcal / target.kcal : 0;

  return {
    kcal,
    protein_g: round2(target.protein_g - consumed.protein_g),
    carbs_g: round2(target.carbs_g - consumed.carbs_g),
    fat_g: round2(target.fat_g - consumed.fat_g),
    kcalProgress: clamp(progress, 0, 2),
    isOver: kcal < 0,
  };
}

/**
 * Mean daily intake across a span.
 *
 * `days` is passed explicitly rather than inferred from the number of rows,
 * because the expenditure model needs the mean over *elapsed* days. Inferring
 * it would silently exclude unlogged days and inflate the apparent intake,
 * which would then be read as a higher expenditure — the single easiest way
 * to corrupt the adaptive estimate.
 */
export function meanDailyIntake(
  dailyTotals: readonly MacroTotals[],
  days: number,
): MacroTotals {
  if (days <= 0) return ZERO_MACROS;
  const total = sumMacros(dailyTotals);
  return {
    kcal: round2(total.kcal / days),
    protein_g: round2(total.protein_g / days),
    carbs_g: round2(total.carbs_g / days),
    fat_g: round2(total.fat_g / days),
  };
}

/**
 * Share of days in a span that carry at least one logged entry.
 *
 * This is the "adherence" figure on the phase dashboard (spec 8.4) and the
 * sufficiency gate for the adaptive estimate: a week logged on two days
 * cannot support a target adjustment.
 */
export function loggedDayRatio(
  loggedDays: number,
  totalDays: number,
): number {
  if (totalDays <= 0) return 0;
  return clamp(loggedDays / totalDays, 0, 1);
}

function toMacros(entry: MacroTotals): MacroTotals {
  return {
    kcal: entry.kcal,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
