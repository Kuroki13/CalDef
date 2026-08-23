import "server-only";

/**
 * Daily target persistence.
 *
 * A target is computed once per day and stored, rather than recomputed on
 * every render. That is deliberate: the target you were working to on a
 * given day is part of the record. Recomputing it later — after a weigh-in
 * moved, or after the expenditure estimate updated — would silently rewrite
 * history and make past adherence figures meaningless.
 */

import { isAdjustmentDue, recordWeeklyCheckin } from "@/lib/checkin";
import { type IsoDate, todayInTimeZone } from "@/lib/dates";
import { getExpenditure } from "@/lib/expenditure";
import type { MacroTotals } from "@/lib/nutrition/macros";
import { getAccountSetup } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { ageFromBirthDate, formulaTdee } from "@/lib/tdee/bmr";
import { type DailyTarget, dailyTargetFor } from "@/lib/tdee/daily-target";
import type { Enums } from "@/types/database";

export type StoredTarget = {
  calories: number;
  macros: MacroTotals;
  basisTdeeKcal: number | null;
  source: string;
  /** Present only when the target was computed rather than read back. */
  detail: DailyTarget | null;
};

/**
 * Reads the stored target for a date, computing and storing one if absent.
 *
 * Returns null when the account is not set up far enough to compute
 * anything, which the caller renders as a prompt rather than as an error.
 */
export async function getOrCreateDailyTarget(
  date: IsoDate,
): Promise<StoredTarget | null> {
  const supabase = await createClient();

  const { data: existing, error } = await supabase
    .from("daily_targets")
    .select("calories, protein_g, carbs_g, fat_g, basis_tdee_kcal, source")
    .eq("target_date", date)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (existing) {
    return {
      calories: existing.calories,
      macros: {
        kcal: existing.calories,
        protein_g: Number(existing.protein_g),
        carbs_g: Number(existing.carbs_g),
        fat_g: Number(existing.fat_g),
      },
      basisTdeeKcal:
        existing.basis_tdee_kcal === null
          ? null
          : Number(existing.basis_tdee_kcal),
      source: existing.source,
      detail: null,
    };
  }

  // No target for this date yet. Before computing a new one, check whether
  // an adjustment is even due.
  //
  // "Targets adjust at most weekly" (spec §6) is enforced here rather than
  // by a reminder somewhere: on any day inside the current week the previous
  // target is carried forward untouched, so a fresh expenditure reading
  // cannot move today's number. Recomputing daily would let the target drift
  // with every weigh-in, which is exactly the reactivity the smoothing and
  // the weekly cadence exist to prevent.
  const previous = await getMostRecentTarget(date);

  if (previous && !isAdjustmentDue(previous.target_date, date)) {
    const carried = await carryForward(previous, date);
    if (carried) return carried;
  }

  const computed = await computeTargetFor(date);
  if (!computed) return null;

  // Only today and future dates get written. Back-filling a target for a day
  // that has already passed would invent a goal the user never actually had,
  // and adherence figures computed against it would be fiction.
  const source = previous ? "weekly_adjustment" : "initial";

  if (date >= computed.today) {
    const { error: insertError } = await supabase.from("daily_targets").insert({
      user_id: computed.userId,
      target_date: date,
      calories: computed.target.calories,
      protein_g: computed.target.macros.protein_g,
      carbs_g: computed.target.macros.carbs_g,
      fat_g: computed.target.macros.fat_g,
      basis_tdee_kcal: computed.target.basisTdeeKcal,
      source,
    });
    // A duplicate means another request won the race, which is fine.
    if (insertError && !insertError.message.includes("duplicate")) {
      throw new Error(insertError.message);
    }

    if (previous) {
      // The check-in is a record of the adjustment, not a precondition for
      // it — losing it must not cost the user their target.
      try {
        await recordWeeklyCheckin(
          computed.userId,
          date,
          computed.timeZone,
          {
            weekStartDate: date,
            previousTargetKcal: previous.calories,
            newTargetKcal: computed.target.calories,
            reason: computed.target.explanation,
          },
        );
      } catch {
        // Intentionally swallowed; see above.
      }
    }
  }

  return {
    calories: computed.target.calories,
    macros: computed.target.macros,
    basisTdeeKcal: computed.target.basisTdeeKcal,
    source,
    detail: computed.target,
  };
}

/** Mirrors the `public.target_source` enum, so a carried-forward row keeps
 *  the provenance of the target it copies. */
type TargetSource = Enums<"target_source">;

type PreviousTarget = {
  target_date: IsoDate;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  basis_tdee_kcal: number | null;
  source: TargetSource;
};

/** The most recent stored target strictly before `date`. */
async function getMostRecentTarget(
  date: IsoDate,
): Promise<PreviousTarget | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("daily_targets")
    .select(
      "target_date, calories, protein_g, carbs_g, fat_g, basis_tdee_kcal, source",
    )
    .lt("target_date", date)
    .order("target_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    target_date: data.target_date,
    calories: data.calories,
    protein_g: Number(data.protein_g),
    carbs_g: Number(data.carbs_g),
    fat_g: Number(data.fat_g),
    basis_tdee_kcal:
      data.basis_tdee_kcal === null ? null : Number(data.basis_tdee_kcal),
    source: data.source,
  };
}

/** Copies an in-week target onto `date` so the number stays put. */
async function carryForward(
  previous: PreviousTarget,
  date: IsoDate,
): Promise<StoredTarget | null> {
  const setup = await getAccountSetup();
  if (!setup.profile) return null;

  const today = todayInTimeZone(setup.profile.timezone);
  const supabase = await createClient();

  if (date >= today) {
    const { error } = await supabase.from("daily_targets").insert({
      user_id: setup.profile.id,
      target_date: date,
      calories: previous.calories,
      protein_g: previous.protein_g,
      carbs_g: previous.carbs_g,
      fat_g: previous.fat_g,
      basis_tdee_kcal: previous.basis_tdee_kcal,
      source: previous.source,
    });
    if (error && !error.message.includes("duplicate")) {
      throw new Error(error.message);
    }
  }

  return {
    calories: previous.calories,
    macros: {
      kcal: previous.calories,
      protein_g: previous.protein_g,
      carbs_g: previous.carbs_g,
      fat_g: previous.fat_g,
    },
    basisTdeeKcal: previous.basis_tdee_kcal,
    source: previous.source,
    detail: null,
  };
}

type ComputedTarget = {
  target: DailyTarget;
  userId: string;
  /** The account's current calendar day, in the profile's timezone. */
  today: IsoDate;
  timeZone: string;
};

/**
 * Computes a target from the profile, goal and expenditure estimate.
 *
 * Uses the adaptive estimate once it is publishable and falls back to the
 * formula seed otherwise. `estimateAdaptiveTdee` already refuses to publish
 * on thin data, so this reads `isPublishable` rather than re-deciding: the
 * gate lives in one place.
 */
async function computeTargetFor(date: IsoDate): Promise<ComputedTarget | null> {
  const setup = await getAccountSetup();
  const { profile, goal, latestWeightKg } = setup;

  if (
    !profile ||
    !goal ||
    latestWeightKg === null ||
    profile.height_cm === null ||
    profile.birth_date === null
  ) {
    return null;
  }

  const expenditure = await getExpenditure(date);

  const tdeeKcal =
    expenditure && expenditure.estimate.isPublishable
      ? expenditure.tdeeKcal
      : (expenditure?.formulaTdeeKcal ??
        formulaTdee(
          {
            weightKg: latestWeightKg,
            heightCm: profile.height_cm,
            age: ageFromBirthDate(profile.birth_date, date),
            sex: profile.sex,
          },
          goal.activity_level,
        ));

  // The deficit and the protein floor are both bodyweight-derived, which
  // makes them decisions — so they read the smoothed trend, not the last
  // scale reading (ARCHITECTURE §6). Using the raw value would let a single
  // salty evening move tomorrow's calorie target.
  const decisionWeightKg = expenditure?.baselineWeightKg ?? latestWeightKg;

  return {
    target: dailyTargetFor({
      goalType: goal.goal_type,
      weightKg: decisionWeightKg,
      tdeeKcal,
      proteinGPerKg: Number(goal.protein_g_per_kg),
    }),
    userId: profile.id,
    today: todayInTimeZone(profile.timezone),
    timeZone: profile.timezone,
  };
}
