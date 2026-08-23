import "server-only";

/**
 * The weekly check-in.
 *
 * This is the mechanism behind "adjust targets weekly at most" (spec §6,
 * ARCHITECTURE §6). It is not a reminder or a screen — it is the only place
 * a calorie target is allowed to change. `targets.ts` carries the current
 * target forward unchanged on every other day, so the cadence is enforced by
 * construction rather than by remembering to check a date somewhere.
 *
 * `weekly_checkins` has a unique constraint on `(user_id, week_start_date)`,
 * so a week cannot be adjusted twice however many times this runs.
 */

import { type IsoDate, addDays, daysBetween, startOfIsoWeek } from "@/lib/dates";
import { getDailyTotals } from "@/lib/diary";
import { meanDailyIntake } from "@/lib/nutrition/totals";
import { createClient } from "@/lib/supabase/server";
import { latestTrendKg, windowOfDays } from "@/lib/tdee/trend";
import { getWeightHistory } from "@/lib/weight";

export const CHECKIN_INTERVAL_DAYS = 7;

/** Whether enough time has passed since the last target to adjust again. */
export function isAdjustmentDue(
  lastTargetDate: IsoDate | null,
  today: IsoDate,
): boolean {
  if (lastTargetDate === null) return true;
  return daysBetween(lastTargetDate, today) >= CHECKIN_INTERVAL_DAYS;
}

export type CheckinRecord = {
  weekStartDate: IsoDate;
  previousTargetKcal: number | null;
  newTargetKcal: number;
  reason: string;
};

/**
 * Records the week's summary alongside a target change.
 *
 * Written on a best-effort basis by the caller: the check-in is a record of
 * what happened, and losing it must not prevent the target itself from being
 * stored.
 */
export async function recordWeeklyCheckin(
  userId: string,
  today: IsoDate,
  timeZone: string,
  record: CheckinRecord,
): Promise<void> {
  const supabase = await createClient();

  const from = addDays(today, -(CHECKIN_INTERVAL_DAYS - 1));
  const [history, totalsByDate] = await Promise.all([
    getWeightHistory(timeZone),
    getDailyTotals(from, today),
  ]);

  const week = windowOfDays(history.trend, CHECKIN_INTERVAL_DAYS);
  const startTrend = week.length ? week[0].trendKg : null;
  const endTrend = latestTrendKg(week);
  const mean = meanDailyIntake(
    [...totalsByDate.values()],
    CHECKIN_INTERVAL_DAYS,
  );

  const { error } = await supabase.from("weekly_checkins").upsert(
    {
      user_id: userId,
      week_start_date: startOfIsoWeek(record.weekStartDate),
      mean_intake_kcal: mean.kcal,
      mean_protein_g: mean.protein_g,
      start_trend_kg: startTrend,
      end_trend_kg: endTrend,
      change_kg:
        startTrend !== null && endTrend !== null
          ? round3(endTrend - startTrend)
          : null,
      logged_days: totalsByDate.size,
      adherence_pct: round2(
        (totalsByDate.size / CHECKIN_INTERVAL_DAYS) * 100,
      ),
      previous_target_kcal: record.previousTargetKcal,
      new_target_kcal: record.newTargetKcal,
      adjustment_reason: record.reason,
    },
    { onConflict: "user_id,week_start_date" },
  );

  if (error) throw new Error(error.message);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
