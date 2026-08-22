/**
 * Weight trend smoothing.
 *
 * The scale is a noisy instrument. Day-to-day it reports water, sodium, gut
 * contents and glycogen far more than it reports fat, and a single reading
 * routinely moves ±1 kg for reasons that have nothing to do with energy
 * balance. Every decision in this app — the expenditure estimate, the weekly
 * adjustment, the phase projection — reads the smoothed series produced here
 * and never the raw values. See ARCHITECTURE §6.
 */

import { type IsoDate, addDays, daysBetween } from "@/lib/dates";

export type WeightEntry = {
  entry_date: IsoDate;
  weight_kg: number;
};

export type TrendPoint = {
  date: IsoDate;
  /** The scale reading for this date, if one exists. */
  actualKg: number | null;
  /** The smoothed estimate, defined on every day in the span. */
  trendKg: number;
};

/**
 * Smoothing factor for the exponentially weighted moving average.
 *
 * 0.1 gives roughly a 19-day centre of mass — slow enough that one bad
 * weigh-in barely registers, fast enough to turn within a couple of weeks
 * when the real trajectory changes. This is the conventional choice for
 * bodyweight trend tracking.
 */
export const DEFAULT_ALPHA = 0.1;

/**
 * Builds a continuous daily trend series.
 *
 * Gaps are carried forward rather than interpolated: on a day with no
 * weigh-in the trend holds its previous value, which is what an EWMA over an
 * irregular series should do. Interpolating would invent readings and make
 * the trend look more certain than it is.
 */
export function weightTrend(
  entries: readonly WeightEntry[],
  alpha: number = DEFAULT_ALPHA,
): TrendPoint[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) =>
    a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0,
  );
  const byDate = new Map(sorted.map((e) => [e.entry_date, e.weight_kg]));

  const first = sorted[0].entry_date;
  const last = sorted[sorted.length - 1].entry_date;
  const span = daysBetween(first, last);

  const points: TrendPoint[] = [];
  // Seeded with the first reading, so the series starts on the scale rather
  // than at zero and does not need a warm-up period.
  let trend = sorted[0].weight_kg;

  for (let i = 0; i <= span; i++) {
    const date = addDays(first, i);
    const actual = byDate.get(date) ?? null;
    if (actual !== null) {
      trend = alpha * actual + (1 - alpha) * trend;
    }
    points.push({ date, actualKg: actual, trendKg: round2(trend) });
  }

  return points;
}

/** The most recent smoothed value, or null when there is nothing to smooth. */
export function latestTrendKg(points: readonly TrendPoint[]): number | null {
  return points.length ? points[points.length - 1].trendKg : null;
}

/**
 * Rate of change of the trend, in kg per week.
 *
 * Measured across the whole window rather than between the last two points,
 * because a per-day slope on a smoothed series is dominated by the smoothing
 * rather than by the underlying change. Negative means losing.
 */
export function trendChangeKgPerWeek(
  points: readonly TrendPoint[],
): number | null {
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const days = daysBetween(first.date, last.date);
  if (days <= 0) return null;

  return round3(((last.trendKg - first.trendKg) / days) * 7);
}

/** The trailing window the weekly adjustment reads. */
export function windowOfDays(
  points: readonly TrendPoint[],
  days: number,
): TrendPoint[] {
  if (points.length === 0 || days <= 0) return [];
  return points.slice(Math.max(points.length - days, 0));
}

/**
 * Projects the trend forward at its current rate.
 *
 * Deliberately linear. A curve fitted to a handful of weeks of bodyweight
 * data implies a confidence the data does not support, and the spec asks for
 * a plain "at your current rate" projection (8.6).
 */
export function projectWeightKg(
  currentTrendKg: number,
  kgPerWeek: number,
  daysAhead: number,
): number {
  return round2(currentTrendKg + (kgPerWeek * daysAhead) / 7);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
