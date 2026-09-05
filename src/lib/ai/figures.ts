import "server-only";

/**
 * The numbers the assistant is allowed to know.
 *
 * This is the whole of what the app tells Gemini about the person asking.
 * `AnonymousFigures` has only `number` fields, so nothing else is even
 * assignable — but the point of gathering them here, in one function, is
 * that the list is short enough to read and check.
 *
 * Deliberately absent, per CLAUDE.md: name, email, user id, birth date,
 * height, goal weight, and any weight *history*. A single current trend
 * figure and this week's rate of change are enough to answer "am I on
 * track"; a series would be a body-weight history leaving the machine.
 */

import { getExpenditure } from "@/lib/expenditure";
import { getDiaryDay } from "@/lib/diary";
import type { AnonymousFigures } from "@/lib/llm/types";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";
import { todayInTimeZone } from "@/lib/dates";

/**
 * Collects today's figures, omitting whatever is not yet known.
 *
 * An absent figure is left out rather than sent as zero: telling the model
 * someone has eaten 0 kcal when nothing is logged yet would produce advice
 * about a fast they are not on.
 */
export async function currentFigures(): Promise<AnonymousFigures> {
  const { profile } = await getAccountSetup();
  if (!profile) return {};

  const today = todayInTimeZone(profile.timezone);

  const [day, target, expenditure] = await Promise.all([
    getDiaryDay(today),
    getOrCreateDailyTarget(today),
    getExpenditure(),
  ]);

  const figures: AnonymousFigures = {};

  if (target) {
    figures.targetCalories = target.calories;
    figures.targetProteinG = target.macros.protein_g;
  }

  if (day.entries.length > 0) {
    figures.caloriesToday = day.totals.totals.kcal;
    figures.proteinTodayG = day.totals.totals.protein_g;
  }

  if (expenditure) {
    figures.estimatedExpenditureKcal = expenditure.tdeeKcal;
    figures.trendWeightKg = expenditure.baselineWeightKg;
    if (expenditure.trendChangeKgPerWeek !== null) {
      figures.weeklyChangeKg = expenditure.trendChangeKgPerWeek;
    }
  }

  return figures;
}
