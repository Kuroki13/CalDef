/**
 * The four series the phase graph draws (spec §8.7).
 *
 *   actual       — daily scale readings, the noisy truth
 *   trend        — the smoothed line every decision is based on
 *   recommended  — where a sustainable rate lands
 *   stretch      — the aspirational line, drawn but never prescribed against
 *
 * Kept separate from the chart component so the shape of the data is
 * testable without rendering anything, and so the rule that the stretch line
 * is *only* ever a drawing has one obvious home.
 */

import { type IsoDate, addDays, daysBetween } from "@/lib/dates";
import type { TrendPoint } from "@/lib/tdee/trend";

export type PhaseSeriesPoint = {
  /** 1-based, matching "day N of 56". */
  day: number;
  date: IsoDate;
  actualKg: number | null;
  trendKg: number | null;
  recommendedKg: number;
  stretchKg: number | null;
};

export type PhaseSeriesInput = {
  startDate: IsoDate;
  durationDays: number;
  startWeightKg: number;
  /** Positive magnitude, kg/week. */
  recommendedKgPerWeek: number;
  stretchTargetKg: number | null;
  /** The smoothed series, which also carries the raw readings. */
  trend: readonly TrendPoint[];
};

/**
 * Builds one point per day of the phase.
 *
 * The recommended and stretch lines are defined across the whole phase
 * because they are projections; actual and trend are null on days that have
 * not happened yet. Drawing a trend value into the future would present a
 * projection as a measurement.
 */
export function buildPhaseSeries({
  startDate,
  durationDays,
  startWeightKg,
  recommendedKgPerWeek,
  stretchTargetKg,
  trend,
}: PhaseSeriesInput): PhaseSeriesPoint[] {
  const byDate = new Map(trend.map((p) => [p.date, p]));
  const rate = Math.abs(recommendedKgPerWeek);

  // The stretch line runs from the starting weight to the stretch target
  // across the phase, whatever rate that implies — it is a goalpost.
  const stretchPerDay =
    stretchTargetKg === null || durationDays <= 0
      ? null
      : (startWeightKg - stretchTargetKg) / durationDays;

  const points: PhaseSeriesPoint[] = [];

  for (let offset = 0; offset <= durationDays; offset++) {
    const date = addDays(startDate, offset);
    const observed = byDate.get(date);

    points.push({
      day: offset + 1,
      date,
      actualKg: observed?.actualKg ?? null,
      trendKg: observed?.trendKg ?? null,
      recommendedKg: round2(startWeightKg - (rate * offset) / 7),
      stretchKg:
        stretchPerDay === null
          ? null
          : round2(startWeightKg - stretchPerDay * offset),
    });
  }

  return points;
}

/** The vertical extent the chart needs, including any goal marker. */
export function seriesBounds(
  points: readonly PhaseSeriesPoint[],
  extra: readonly (number | null)[] = [],
): { min: number; max: number } {
  const values: number[] = [];

  for (const p of points) {
    values.push(p.recommendedKg);
    if (p.actualKg !== null) values.push(p.actualKg);
    if (p.trendKg !== null) values.push(p.trendKg);
    if (p.stretchKg !== null) values.push(p.stretchKg);
  }
  for (const value of extra) {
    if (value !== null) values.push(value);
  }

  if (values.length === 0) return { min: 0, max: 1 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would give a zero-height range and divide by zero.
  const pad = Math.max((max - min) * 0.08, 0.5);

  return { min: min - pad, max: max + pad };
}

/** How far through the phase a date sits, clamped to the phase's own span. */
export function dayIndexFor(
  startDate: IsoDate,
  durationDays: number,
  date: IsoDate,
): number {
  const offset = daysBetween(startDate, date);
  return Math.min(Math.max(offset, 0), durationDays);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
