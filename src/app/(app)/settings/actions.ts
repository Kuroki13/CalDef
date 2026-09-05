"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient, requireUserId } from "@/lib/supabase/server";
import { lengthToCm, massToKg } from "@/lib/units";

export type SettingsState = { error?: string; saved?: boolean };

const schema = z.object({
  displayName: z.string().trim().max(80),
  sex: z.enum(["male", "female", "other"]),
  birthDate: z.iso.date(),
  unitSystem: z.enum(["metric", "imperial"]),
  height: z.coerce.number().positive(),
  goalType: z.enum(["lose", "maintain", "gain", "recomp"]),
  goalWeight: z.coerce.number().positive(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "very", "extra"]),
  proteinPerKg: z.coerce.number().min(0.5).max(4),
  /** Re-synced from the browser; absent without JavaScript, and that is fine. */
  timezone: z.string().trim().max(64).optional(),
});

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please check the highlighted fields and try again." };
  }
  const input = parsed.data;

  const heightCm = lengthToCm(input.height, input.unitSystem);
  const goalWeightKg = massToKg(input.goalWeight, input.unitSystem);

  if (heightCm < 100 || heightCm > 250) {
    return { error: "That height looks out of range. Please check it." };
  }
  if (goalWeightKg < 20 || goalWeightKg > 500) {
    return { error: "That goal weight looks out of range. Please check it." };
  }

  // The same range onboarding applies. Without it the two forms disagreed
  // about what a valid birth date is, and an out-of-range one reached the
  // database — where the column's own check rejected it and the raw Postgres
  // message was shown to the user as though it were guidance.
  const birthYear = Number(input.birthDate.slice(0, 4));
  const thisYear = new Date().getUTCFullYear();
  if (thisYear - birthYear < 13 || thisYear - birthYear > 120) {
    return { error: "Please enter a valid date of birth." };
  }

  const userId = await requireUserId();
  const supabase = await createClient();

  const profileUpdate = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName || null,
      sex: input.sex,
      birth_date: input.birthDate,
      height_cm: heightCm,
      unit_system: input.unitSystem,
      // Only when the browser supplied one. Overwriting a good timezone with
      // an empty string on a no-JS submission would be worse than leaving it.
      ...(input.timezone ? { timezone: input.timezone } : {}),
    })
    .eq("id", userId);
  if (profileUpdate.error) return { error: profileUpdate.error.message };

  const goalUpdate = await supabase
    .from("goals")
    .update({
      goal_type: input.goalType,
      activity_level: input.activityLevel,
      final_goal_weight_kg: goalWeightKg,
      protein_g_per_kg: input.proteinPerKg,
    })
    .eq("user_id", userId)
    .eq("is_active", true);
  if (goalUpdate.error) return { error: goalUpdate.error.message };

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { saved: true };
}

/**
 * The AI kill switch. Everything in CalDef works with this off — food search,
 * logging, the expenditure model and the phase mode are all AI-independent.
 */
export async function setAiEnabled(enabled: boolean): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ ai_enabled: enabled })
    .eq("id", userId);
  revalidatePath("/settings");
}
