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

import { type IsoDate, todayInTimeZone } from "@/lib/dates";
import type { MacroTotals } from "@/lib/nutrition/macros";
import { getAccountSetup } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { ageFromBirthDate, formulaTdee } from "@/lib/tdee/bmr";
import { type DailyTarget, dailyTargetFor } from "@/lib/tdee/daily-target";

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

  const computed = await computeTargetFor(date);
  if (!computed) return null;

  // Only today and future dates get written. Back-filling a target for a day
  // that has already passed would invent a goal the user never actually had,
  // and adherence figures computed against it would be fiction.
  if (date >= computed.today) {
    const { error: insertError } = await supabase.from("daily_targets").insert({
      user_id: computed.userId,
      target_date: date,
      calories: computed.target.calories,
      protein_g: computed.target.macros.protein_g,
      carbs_g: computed.target.macros.carbs_g,
      fat_g: computed.target.macros.fat_g,
      basis_tdee_kcal: computed.target.basisTdeeKcal,
      source: "initial",
    });
    // A duplicate means another request won the race, which is fine.
    if (insertError && !insertError.message.includes("duplicate")) {
      throw new Error(insertError.message);
    }
  }

  return {
    calories: computed.target.calories,
    macros: computed.target.macros,
    basisTdeeKcal: computed.target.basisTdeeKcal,
    source: "initial",
    detail: computed.target,
  };
}

type ComputedTarget = {
  target: DailyTarget;
  userId: string;
  /** The account's current calendar day, in the profile's timezone. */
  today: IsoDate;
};

/**
 * Computes a target from the profile, goal and latest weigh-in.
 *
 * Uses the formula expenditure for now. Phase 6 swaps in the adaptive
 * estimate once there is enough data for it to be published, which is the
 * whole point of `tdee_estimates.method`.
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

  const tdeeKcal = formulaTdee(
    {
      weightKg: latestWeightKg,
      heightCm: profile.height_cm,
      age: ageFromBirthDate(profile.birth_date, date),
      sex: profile.sex,
    },
    goal.activity_level,
  );

  return {
    target: dailyTargetFor({
      goalType: goal.goal_type,
      weightKg: latestWeightKg,
      tdeeKcal,
      proteinGPerKg: Number(goal.protein_g_per_kg),
    }),
    userId: profile.id,
    today: todayInTimeZone(profile.timezone),
  };
}
