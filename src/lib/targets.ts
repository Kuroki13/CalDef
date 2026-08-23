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
import { type MacroTotals, macroTargets } from "@/lib/nutrition/macros";
import { type CutPhase, getActivePhase, phaseCoversDate } from "@/lib/phase";
import { getAccountSetup } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { ageFromBirthDate, formulaTdee } from "@/lib/tdee/bmr";
import { type DailyTarget, dailyTargetFor } from "@/lib/tdee/daily-target";
import { recommendPlan } from "@/lib/tdee/feasibility";
import type { Enums } from "@/types/database";

export type TargetSource = Enums<"target_source">;

export type StoredTarget = {
  calories: number;
  macros: MacroTotals;
  basisTdeeKcal: number | null;
  source: TargetSource;
  /** Present only when the target was computed rather than read back. */
  detail: DailyTarget | null;
  /**
   * What the UI calls this number. There is only ever one target in force,
   * and the user is told which régime produced it — a phase target and an
   * everyday target must never be presented as if interchangeable.
   */
  label: string;
  /** Set when this target is the first day after a phase stopped governing. */
  fellBackFromPhase: boolean;
};

/** Which régime governs a date. `phase` wins wherever a phase covers it. */
export type Governor = "phase" | "everyday";

export function targetLabel(source: TargetSource): string {
  return source === "phase" ? "2-Month Cut target" : "Daily target";
}

export function governorForSource(source: TargetSource): Governor {
  return source === "phase" ? "phase" : "everyday";
}

/**
 * Whether today's target may be recomputed, or must carry yesterday's
 * forward.
 *
 * Two rules, in this order:
 *
 * 1. A change of régime is an *event* and takes effect immediately. Starting
 *    a phase must not wait up to a week to matter, and a phase that has
 *    ended must not keep governing after it stopped.
 * 2. Otherwise the weekly cadence applies. This is deliberately checked
 *    above the phase branch: a phase recomputing every day would reintroduce
 *    the drift that smoothing and the weekly cadence exist to prevent, just
 *    by a different route.
 */
export function shouldRecomputeTarget({
  previousSource,
  previousDate,
  governor,
  date,
}: {
  previousSource: TargetSource | null;
  previousDate: IsoDate | null;
  governor: Governor;
  date: IsoDate;
}): boolean {
  if (previousSource === null || previousDate === null) return true;
  if (governorForSource(previousSource) !== governor) return true;
  return isAdjustmentDue(previousDate, date);
}

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
      label: targetLabel(existing.source),
      fellBackFromPhase: false,
    };
  }

  const setup = await getAccountSetup();
  if (!setup.profile) return null;
  const today = todayInTimeZone(setup.profile.timezone);

  const active = await getActivePhase(today);
  const governor: Governor =
    active && phaseCoversDate(active.phase, date) ? "phase" : "everyday";

  const previous = await getMostRecentTarget(date);

  const governorChanged =
    previous !== null && governorForSource(previous.source) !== governor;

  const recompute = shouldRecomputeTarget({
    previousSource: previous?.source ?? null,
    previousDate: previous?.target_date ?? null,
    governor,
    date,
  });

  if (previous && !recompute) {
    const carried = await carryForward(previous, date);
    if (carried) return carried;
  }

  const computed =
    governor === "phase" && active
      ? await computePhaseTargetFor(date, active.phase)
      : await computeTargetFor(date);
  if (!computed) return null;

  // Only today and future dates get written. Back-filling a target for a day
  // that has already passed would invent a goal the user never actually had,
  // and adherence figures computed against it would be fiction.
  const source: TargetSource =
    governor === "phase"
      ? "phase"
      : previous
        ? "weekly_adjustment"
        : "initial";

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
    label: targetLabel(source),
    fellBackFromPhase: governorChanged && governor === "everyday",
  };
}

/** A carried-forward row keeps the provenance of the target it copies. */
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
    label: targetLabel(previous.source),
    fellBackFromPhase: false,
  };
}

/**
 * The target while a phase is running (spec §8.8).
 *
 * Calorie targets are explicitly *not* fixed for eight weeks. This re-runs
 * the same guardrail that planned the phase, but against today's trend
 * weight and today's expenditure estimate — so the number tracks reality
 * while staying inside the band. It is still reached only on a weekly
 * adjustment; the caller's cadence gate sits above this.
 *
 * The stretch target is the *ask*, never the prescription. `recommendPlan`
 * is what turns it into a calorie figure, and it cannot exceed the band or
 * fall below the floor.
 */
async function computePhaseTargetFor(
  date: IsoDate,
  phase: CutPhase,
): Promise<ComputedTarget | null> {
  const { profile, goal } = await getAccountSetup();
  if (!profile || !goal) return null;

  const expenditure = await getExpenditure(date);
  if (!expenditure) return null;

  const tdeeKcal = expenditure.estimate.isPublishable
    ? expenditure.tdeeKcal
    : expenditure.formulaTdeeKcal;

  const currentWeightKg = expenditure.baselineWeightKg;
  const askKg =
    phase.stretch_target_kg === null
      ? (phase.final_goal_weight_kg === null
          ? currentWeightKg
          : Number(phase.final_goal_weight_kg))
      : Number(phase.stretch_target_kg);

  const plan = recommendPlan({
    currentWeightKg,
    targetWeightKg: askKg,
    startDate: date,
    targetDate: phase.end_date,
    tdeeKcal,
  });

  const proteinGPerKg = Number(goal.protein_g_per_kg);

  return {
    target: {
      calories: plan.recommendedCalories,
      macros: macroTargets(
        plan.recommendedCalories,
        currentWeightKg,
        proteinGPerKg,
      ),
      basisTdeeKcal: Math.round(tdeeKcal * 10) / 10,
      energyBalanceKcal: Math.round(plan.recommendedCalories - tdeeKcal),
      wasFloored: plan.wasConstrained,
      explanation: plan.explanation,
    },
    userId: profile.id,
    today: todayInTimeZone(profile.timezone),
    timeZone: profile.timezone,
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
