"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { todayInTimeZone } from "@/lib/dates";
import { createClient, requireUserId } from "@/lib/supabase/server";
import { lengthToCm, massToKg } from "@/lib/units";

export type OnboardingState = { error?: string };

const schema = z.object({
  displayName: z.string().trim().max(80),
  sex: z.enum(["male", "female", "other"]),
  birthDate: z.iso.date(),
  unitSystem: z.enum(["metric", "imperial"]),
  timezone: z.string().trim().min(1).max(64),
  height: z.coerce.number().positive(),
  currentWeight: z.coerce.number().positive(),
  goalType: z.enum(["lose", "maintain", "gain", "recomp"]),
  goalWeight: z.coerce.number().positive(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "very", "extra"]),
});

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please check the highlighted fields and try again." };
  }
  const input = parsed.data;

  // The form collects values in whichever system the user picked; storage is
  // always kg and cm.
  const heightCm = lengthToCm(input.height, input.unitSystem);
  const weightKg = massToKg(input.currentWeight, input.unitSystem);
  const goalWeightKg = massToKg(input.goalWeight, input.unitSystem);

  if (heightCm < 100 || heightCm > 250) {
    return { error: "That height looks out of range. Please check it." };
  }
  if (weightKg < 20 || weightKg > 500) {
    return { error: "That weight looks out of range. Please check it." };
  }
  if (goalWeightKg < 20 || goalWeightKg > 500) {
    return { error: "That goal weight looks out of range. Please check it." };
  }

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
      timezone: input.timezone,
    })
    .eq("id", userId);
  if (profileUpdate.error) return { error: profileUpdate.error.message };

  // One active goal per user is enforced by a partial unique index, so the
  // previous one has to stand down before the new one is inserted.
  const deactivate = await supabase
    .from("goals")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);
  if (deactivate.error) return { error: deactivate.error.message };

  const goalInsert = await supabase.from("goals").insert({
    user_id: userId,
    goal_type: input.goalType,
    activity_level: input.activityLevel,
    final_goal_weight_kg: goalWeightKg,
  });
  if (goalInsert.error) return { error: goalInsert.error.message };

  const today = todayInTimeZone(input.timezone);
  const weightInsert = await supabase
    .from("weight_entries")
    .upsert(
      { user_id: userId, entry_date: today, weight_kg: weightKg },
      { onConflict: "user_id,entry_date" },
    );
  if (weightInsert.error) return { error: weightInsert.error.message };

  redirect("/dashboard");
}
