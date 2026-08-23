"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { todayInTimeZone } from "@/lib/dates";
import { recordExpenditure } from "@/lib/expenditure";
import { getAccountSetup } from "@/lib/profile";
import { createClient, requireUserId } from "@/lib/supabase/server";
import { massToKg } from "@/lib/units";

export type WeightActionState = { error?: string; ok?: boolean };

const schema = z.object({
  entryDate: z.iso.date(),
  weight: z.coerce.number().positive(),
  note: z.string().trim().max(280).optional(),
});

/**
 * Records a weigh-in.
 *
 * Upserts on `(user_id, entry_date)`, so re-weighing on the same day
 * corrects the entry rather than adding a second one. That matters for the
 * trend: two readings on one day would weight that day twice.
 */
export async function recordWeighIn(
  _prev: WeightActionState,
  formData: FormData,
): Promise<WeightActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid weight and date." };

  const { profile } = await getAccountSetup();
  if (!profile) return { error: "Finish setting up your profile first." };

  const weightKg = massToKg(parsed.data.weight, profile.unit_system);
  if (weightKg < 20 || weightKg > 500) {
    return { error: "That weight looks out of range. Please check it." };
  }

  // A weigh-in dated in the future would corrupt the trend's time axis.
  const today = todayInTimeZone(profile.timezone);
  if (parsed.data.entryDate > today) {
    return { error: "You cannot record a weigh-in for a future date." };
  }

  const userId = await requireUserId();
  const supabase = await createClient();

  const { error } = await supabase.from("weight_entries").upsert(
    {
      user_id: userId,
      entry_date: parsed.data.entryDate,
      weight_kg: weightKg,
      note: parsed.data.note || null,
    },
    { onConflict: "user_id,entry_date" },
  );
  if (error) return { error: error.message };

  // New weight data is exactly when the expenditure estimate can change, so
  // it is recomputed and stored here rather than during a page render —
  // server components should not have write side effects, and a render can
  // be cached or replayed.
  //
  // A failure here must not lose the weigh-in the user just recorded: the
  // estimate is derived data and can be rebuilt on the next weigh-in.
  try {
    await recordExpenditure();
  } catch {
    // Intentionally swallowed; see above.
  }

  revalidatePath("/weight");
  revalidatePath("/dashboard");
  revalidatePath("/diary");
  return { ok: true };
}

export async function deleteWeighIn(formData: FormData): Promise<void> {
  const entryId = Number(formData.get("entryId"));
  if (!Number.isInteger(entryId) || entryId <= 0) return;

  await requireUserId();
  const supabase = await createClient();

  // The delete policy keys on auth.uid(), so a request for someone else's
  // entry affects nothing.
  await supabase.from("weight_entries").delete().eq("id", entryId);

  revalidatePath("/weight");
  revalidatePath("/dashboard");
}
