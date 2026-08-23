import "server-only";

/**
 * Cut phase persistence.
 *
 * A phase is the app's current plan. While one is active it owns the calorie
 * target — `targets.ts` defers to it — and when it ends the everyday target
 * takes over again. Exactly one may be active at a time, which the partial
 * unique index `cut_phases_one_active_per_user_idx` enforces rather than
 * application code.
 */

import { type IsoDate, daysBetween, todayInTimeZone } from "@/lib/dates";
import { createClient, requireUserId } from "@/lib/supabase/server";
import { type Milestone, phaseProgress } from "@/lib/tdee/milestones";
import { type PhasePlan, planPhase } from "@/lib/tdee/phase-plan";
import { trendByDate } from "@/lib/weight";
import type { Tables } from "@/types/database";

export type CutPhase = Tables<"cut_phases">;

export type ActivePhase = {
  phase: CutPhase;
  milestones: Milestone[];
  progress: ReturnType<typeof phaseProgress>;
  /** True once the end date has passed but the row is still `active`. */
  hasElapsed: boolean;
};

/**
 * The running phase, if any.
 *
 * Does not itself close an elapsed phase — that is a write, and this is
 * called from render paths. `hasElapsed` lets the caller show the ending
 * plainly instead, which is what "fall back visibly" requires.
 */
export async function getActivePhase(
  today: IsoDate,
): Promise<ActivePhase | null> {
  const supabase = await createClient();

  const { data: phase, error } = await supabase
    .from("cut_phases")
    .select("*")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!phase) return null;

  const { data: rows, error: milestoneError } = await supabase
    .from("cut_phase_milestones")
    .select(
      "week_number, milestone_date, recommended_weight_kg, stretch_weight_kg, actual_trend_weight_kg",
    )
    .eq("cut_phase_id", phase.id)
    .order("week_number", { ascending: true });
  if (milestoneError) throw new Error(milestoneError.message);

  return {
    phase,
    milestones: (rows ?? []).map((r) => ({
      weekNumber: r.week_number,
      date: r.milestone_date,
      recommendedWeightKg: Number(r.recommended_weight_kg),
      stretchWeightKg:
        r.stretch_weight_kg === null ? null : Number(r.stretch_weight_kg),
      actualTrendWeightKg:
        r.actual_trend_weight_kg === null
          ? null
          : Number(r.actual_trend_weight_kg),
    })),
    progress: phaseProgress(phase.start_date, phase.duration_days, today),
    hasElapsed: daysBetween(phase.start_date, today) >= phase.duration_days,
  };
}

/**
 * Whether a phase governs a given date.
 *
 * A phase owns the target only for days inside its own window. Looking back
 * at a day before the phase started, or forward past its end, must not pull
 * the phase's number onto that day.
 */
export function phaseCoversDate(phase: CutPhase, date: IsoDate): boolean {
  return date >= phase.start_date && date < phase.end_date;
}

export type CreatePhaseInput = {
  startWeightKg: number;
  tdeeKcal: number;
  proteinGPerKg: number;
  finalGoalWeightKg: number | null;
  stretchTargetKg: number | null;
  durationDays?: number;
  timeZone: string;
};

/**
 * Starts a phase, writing it and its weekly roadmap.
 *
 * Refuses when one is already running rather than relying on the unique
 * index to raise — the index is the backstop, but a clear message beats a
 * constraint violation surfacing in the UI.
 */
export async function createPhase(
  input: CreatePhaseInput,
): Promise<{ phase: CutPhase; plan: PhasePlan } | { error: string }> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const today = todayInTimeZone(input.timeZone);

  const existing = await getActivePhase(today);
  if (existing) {
    return { error: "A phase is already running. End it before starting another." };
  }

  let plan: PhasePlan;
  try {
    plan = planPhase({
      startDate: today,
      durationDays: input.durationDays,
      startWeightKg: input.startWeightKg,
      tdeeKcal: input.tdeeKcal,
      proteinGPerKg: input.proteinGPerKg,
      finalGoalWeightKg: input.finalGoalWeightKg,
      stretchTargetKg: input.stretchTargetKg,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "That phase could not be planned.",
    };
  }

  const { data: nextNumber } = await supabase
    .from("cut_phases")
    .select("phase_number")
    .order("phase_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: phase, error } = await supabase
    .from("cut_phases")
    .insert({
      user_id: userId,
      phase_number: (nextNumber?.phase_number ?? 0) + 1,
      start_date: plan.startDate,
      end_date: plan.endDate,
      duration_days: plan.durationDays,
      start_weight_kg: plan.startWeightKg,
      recommended_target_low_kg: plan.recommendedTargetLowKg,
      recommended_target_high_kg: plan.recommendedTargetHighKg,
      stretch_target_kg: plan.stretchTargetKg,
      final_goal_weight_kg: plan.finalGoalWeightKg,
      initial_tdee_kcal: plan.initialTdeeKcal,
      initial_target_kcal: plan.initialTargetKcal,
      initial_protein_g: plan.initialProteinG,
      status: "active",
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  const { error: milestoneError } = await supabase
    .from("cut_phase_milestones")
    .insert(
      plan.milestones.map((m) => ({
        cut_phase_id: phase.id,
        week_number: m.weekNumber,
        milestone_date: m.date,
        recommended_weight_kg: m.recommendedWeightKg,
        stretch_weight_kg: m.stretchWeightKg,
      })),
    );
  if (milestoneError) return { error: milestoneError.message };

  return { phase, plan };
}

/** Closes a phase. `completed` when it ran its course, `abandoned` otherwise. */
export async function endPhase(
  phaseId: number,
  status: "completed" | "abandoned",
): Promise<void> {
  await requireUserId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("cut_phases")
    .update({ status })
    .eq("id", phaseId);
  if (error) throw new Error(error.message);
}

/**
 * Backfills the actual trend onto elapsed milestones.
 *
 * Only past weeks are written. Stamping a trend value onto a future
 * milestone would claim a measurement that has not happened.
 */
export async function refreshMilestoneActuals(
  phaseId: number,
  today: IsoDate,
  trend: Parameters<typeof trendByDate>[0],
): Promise<void> {
  const supabase = await createClient();
  const byDate = trendByDate(trend);

  const { data: rows, error } = await supabase
    .from("cut_phase_milestones")
    .select("id, milestone_date")
    .eq("cut_phase_id", phaseId)
    .lte("milestone_date", today);
  if (error) throw new Error(error.message);

  for (const row of rows ?? []) {
    const actual = byDate.get(row.milestone_date);
    if (actual === undefined) continue;

    const { error: updateError } = await supabase
      .from("cut_phase_milestones")
      .update({
        actual_trend_weight_kg: actual,
        recomputed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
  }
}
