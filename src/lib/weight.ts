import "server-only";

/**
 * Weigh-in reads and the smoothed series built from them.
 *
 * The raw entries exist so the user can see and correct what they typed.
 * Every *decision* — the expenditure estimate, the weekly adjustment, the
 * phase projection — reads `trend` instead, per ARCHITECTURE §6.
 */

import { type IsoDate, addDays, todayInTimeZone } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import {
  type TrendPoint,
  type WeightEntry,
  latestTrendKg,
  trendChangeKgPerWeek,
  weightTrend,
  windowOfDays,
} from "@/lib/tdee/trend";

export type WeightHistory = {
  entries: WeightEntry[];
  trend: TrendPoint[];
  latestKg: number | null;
  latestTrendKg: number | null;
  /** Over the trailing 28 days. Negative means losing. */
  changeKgPerWeek: number | null;
  /** Days in the window carrying a weigh-in. */
  weighInDays: number;
};

/** The window the weekly adjustment and the expenditure estimate read. */
export const ESTIMATE_WINDOW_DAYS = 28;

export async function getWeightHistory(
  timeZone: string,
  windowDays: number = ESTIMATE_WINDOW_DAYS,
): Promise<WeightHistory> {
  const supabase = await createClient();
  const today = todayInTimeZone(timeZone);

  const { data, error } = await supabase
    .from("weight_entries")
    .select("entry_date, weight_kg")
    .order("entry_date", { ascending: true });
  if (error) throw new Error(error.message);

  const entries: WeightEntry[] = (data ?? []).map((row) => ({
    entry_date: row.entry_date,
    weight_kg: Number(row.weight_kg),
  }));

  const trend = weightTrend(entries);
  const window = windowOfDays(trend, windowDays);
  const from = addDays(today, -(windowDays - 1));

  return {
    entries,
    trend,
    latestKg: entries.length ? entries[entries.length - 1].weight_kg : null,
    latestTrendKg: latestTrendKg(trend),
    changeKgPerWeek: trendChangeKgPerWeek(window),
    weighInDays: entries.filter((e) => e.entry_date >= from).length,
  };
}

/** Recent weigh-ins, newest first, for the history list. */
export async function getRecentWeighIns(limit = 30): Promise<
  (WeightEntry & { id: number; note: string | null })[]
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("weight_entries")
    .select("id, entry_date, weight_kg, note")
    .order("entry_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    entry_date: row.entry_date,
    weight_kg: Number(row.weight_kg),
    note: row.note,
  }));
}

/** Trend values keyed by date, for backfilling phase milestones. */
export function trendByDate(trend: readonly TrendPoint[]): Map<IsoDate, number> {
  return new Map(trend.map((p) => [p.date, p.trendKg]));
}
