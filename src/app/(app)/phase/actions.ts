"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { todayInTimeZone } from "@/lib/dates";
import { getExpenditure } from "@/lib/expenditure";
import { createPhase, endPhase, getActivePhase } from "@/lib/phase";
import { getAccountSetup } from "@/lib/profile";
import { DEFAULT_PHASE_DAYS } from "@/lib/tdee/phase-plan";
import { massToKg } from "@/lib/units";

export type PhaseActionState = { error?: string; ok?: boolean };

const startSchema = z.object({
  stretchTarget: z.coerce.number().positive().optional(),
  durationDays: z.coerce.number().int().min(7).max(365).default(DEFAULT_PHASE_DAYS),
});

/**
 * Starts a 2-Month Cut phase.
 *
 * The starting weight is the smoothed trend, not the last reading — a phase
 * anchored to a heavy morning would carry that error for eight weeks.
 */
export async function startPhase(
  _prev: PhaseActionState,
  formData: FormData,
): Promise<PhaseActionState> {
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the target and duration." };

  const { profile, goal } = await getAccountSetup();
  if (!profile || !goal) {
    return { error: "Finish setting up your profile and goal first." };
  }

  const expenditure = await getExpenditure();
  if (!expenditure) {
    return { error: "Record a weigh-in before starting a phase." };
  }

  const stretchTargetKg =
    parsed.data.stretchTarget === undefined
      ? null
      : massToKg(parsed.data.stretchTarget, profile.unit_system);

  if (
    stretchTargetKg !== null &&
    (stretchTargetKg < 20 || stretchTargetKg >= expenditure.baselineWeightKg)
  ) {
    return {
      error:
        "The stretch target should be below your current trend weight and a " +
        "plausible bodyweight.",
    };
  }

  const result = await createPhase({
    startWeightKg: expenditure.baselineWeightKg,
    tdeeKcal: expenditure.estimate.isPublishable
      ? expenditure.tdeeKcal
      : expenditure.formulaTdeeKcal,
    proteinGPerKg: Number(goal.protein_g_per_kg),
    finalGoalWeightKg:
      goal.final_goal_weight_kg === null
        ? null
        : Number(goal.final_goal_weight_kg),
    stretchTargetKg,
    durationDays: parsed.data.durationDays,
    timeZone: profile.timezone,
  });

  if ("error" in result) return { error: result.error };

  revalidateAll();
  return { ok: true };
}

/**
 * Ends the running phase.
 *
 * `completed` when it ran its course, `abandoned` when stopped early — the
 * distinction matters for the day-56 report and for proposing a Phase 2.
 */
export async function stopPhase(): Promise<void> {
  const { profile } = await getAccountSetup();
  if (!profile) return;

  const today = todayInTimeZone(profile.timezone);
  const active = await getActivePhase(today);
  if (!active) return;

  await endPhase(
    active.phase.id,
    active.hasElapsed ? "completed" : "abandoned",
  );

  revalidateAll();
}

/**
 * The phase governs the calorie target, so ending or starting one changes
 * what the diary and dashboard show. Every surface that renders a target has
 * to be invalidated together or they will disagree.
 */
function revalidateAll(): void {
  revalidatePath("/phase");
  revalidatePath("/diary");
  revalidatePath("/dashboard");
  revalidatePath("/weight");
}
