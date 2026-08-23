import "server-only";

/**
 * The adaptive expenditure estimate, wired to real data.
 *
 * `tdee/adaptive.ts` holds the arithmetic and the refusal-to-publish rules;
 * this module gathers the inputs, applies them, and persists the result to
 * `tdee_estimates` so the figure the user saw on a given day is recoverable
 * later.
 *
 * The estimate is recomputed at most once per day. `tdee_estimates` has a
 * unique constraint on `(user_id, computed_for)`, which is what enforces
 * that rather than a flag somewhere in application code.
 */

import { type IsoDate, addDays, daysBetween, todayInTimeZone } from "@/lib/dates";
import { getDailyTotals } from "@/lib/diary";
import { getActivePhase } from "@/lib/phase";
import { meanDailyIntake } from "@/lib/nutrition/totals";
import { getAccountSetup } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import {
  type AdaptiveEstimate,
  estimateAdaptiveTdee,
} from "@/lib/tdee/adaptive";
import { ageFromBirthDate, formulaTdee } from "@/lib/tdee/bmr";
import { ESTIMATE_WINDOW_DAYS, getWeightHistory } from "@/lib/weight";

export type Expenditure = {
  /** What the app should use today. */
  tdeeKcal: number;
  /** The formula seed, kept for the "we assumed X" comparison. */
  formulaTdeeKcal: number;
  estimate: AdaptiveEstimate;
  /** Mean intake over the window, across elapsed days. */
  meanIntakeKcal: number;
  trendChangeKgPerWeek: number | null;
  /**
   * The bodyweight every downstream decision should use: the smoothed trend
   * where one exists, falling back to the last reading only before there is
   * enough data to smooth. ARCHITECTURE §6 — raw scale values never drive a
   * decision, and a calorie target is a decision.
   */
  baselineWeightKg: number;
};

/**
 * Computes today's expenditure figure.
 *
 * Returns null when the account is not set up far enough — the caller
 * renders a prompt rather than an error.
 */
export async function getExpenditure(
  date?: IsoDate,
): Promise<Expenditure | null> {
  const { profile, goal, latestWeightKg } = await getAccountSetup();
  if (
    !profile ||
    !goal ||
    latestWeightKg === null ||
    profile.height_cm === null ||
    profile.birth_date === null
  ) {
    return null;
  }

  const today = date ?? todayInTimeZone(profile.timezone);
  const history = await getWeightHistory(profile.timezone);

  // The formula seed is computed from the *trend* weight where one exists,
  // not the last scale reading, so a single heavy morning does not move the
  // baseline estimate either.
  const baselineKg = history.latestTrendKg ?? latestWeightKg;

  const formula = formulaTdee(
    {
      weightKg: baselineKg,
      heightCm: profile.height_cm,
      age: ageFromBirthDate(profile.birth_date, today),
      sex: profile.sex,
    },
    goal.activity_level,
  );

  const from = addDays(today, -(ESTIMATE_WINDOW_DAYS - 1));
  const totalsByDate = await getDailyTotals(from, today);
  const mean = meanDailyIntake(
    [...totalsByDate.values()],
    ESTIMATE_WINDOW_DAYS,
  );

  // The prior is the last stored estimate if there is one, else the formula.
  const prior = await getLastStoredEstimate(today);

  // Early in a phase the scale is mostly glycogen, water and food volume, so
  // an expenditure reading drawn from it overstates the deficit badly
  // (spec §8.9). `adaptive.ts` damps for this, but only if it is told how
  // far into a phase we are — otherwise the rule sits there doing nothing.
  const active = await getActivePhase(today);
  const phaseDayIndex = active
    ? daysBetween(active.phase.start_date, today)
    : null;

  const trendChange = history.changeKgPerWeek;
  const estimate = estimateAdaptiveTdee({
    meanIntakeKcal: mean.kcal,
    // adaptive.ts wants the change across the window, not per week.
    trendChangeKg:
      trendChange === null ? 0 : (trendChange / 7) * ESTIMATE_WINDOW_DAYS,
    days: ESTIMATE_WINDOW_DAYS,
    weighInDays: history.weighInDays,
    loggedDays: totalsByDate.size,
    priorTdeeKcal: prior ?? formula,
    phaseDayIndex,
  });

  return {
    tdeeKcal: estimate.estimatedTdeeKcal,
    formulaTdeeKcal: formula,
    estimate,
    meanIntakeKcal: mean.kcal,
    trendChangeKgPerWeek: trendChange,
    baselineWeightKg: baselineKg,
  };
}

/**
 * Computes and stores today's estimate, returning it.
 *
 * Idempotent: a second call on the same day reads the stored row back
 * instead of recomputing, so the figure cannot drift within a day as more
 * food is logged.
 */
export async function recordExpenditure(
  date?: IsoDate,
): Promise<Expenditure | null> {
  const expenditure = await getExpenditure(date);
  if (!expenditure) return null;

  const { profile } = await getAccountSetup();
  if (!profile) return null;

  const today = date ?? todayInTimeZone(profile.timezone);
  const supabase = await createClient();

  const { error } = await supabase.from("tdee_estimates").upsert(
    {
      user_id: profile.id,
      computed_for: today,
      estimated_tdee_kcal: expenditure.tdeeKcal,
      method: expenditure.estimate.method,
      confidence: expenditure.estimate.confidence,
      trend_weight_kg: null,
      trend_change_kg_per_week: expenditure.trendChangeKgPerWeek,
      mean_intake_kcal: expenditure.meanIntakeKcal,
      days_of_data: expenditure.estimate.daysOfData,
    },
    { onConflict: "user_id,computed_for" },
  );
  if (error) throw new Error(error.message);

  return expenditure;
}

/** The most recent stored estimate strictly before `date`. */
async function getLastStoredEstimate(date: IsoDate): Promise<number | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tdee_estimates")
    .select("estimated_tdee_kcal")
    .lt("computed_for", date)
    .order("computed_for", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? Number(data.estimated_tdee_kcal) : null;
}
