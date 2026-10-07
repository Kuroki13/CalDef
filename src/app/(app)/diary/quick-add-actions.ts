"use server";

/** Quick Add (spec §12G): the user's own estimate, as one diary entry. */

import { revalidatePath } from "next/cache";

import { quickAdd } from "@/lib/quick-add";
import { quickAddSchema } from "@/lib/quick-add-input";

export type QuickAddState = { error?: string; ok?: boolean; notice?: string };

export async function quickAddAction(
  _prev: QuickAddState,
  formData: FormData,
): Promise<QuickAddState> {
  const parsed = quickAddSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const result = await quickAdd(parsed.data);
  if ("error" in result) return { error: result.error };

  revalidatePath("/diary");
  revalidatePath("/dashboard");
  return {
    ok: true,
    notice: `Added "${parsed.data.label}" — ${Math.round(parsed.data.kcal)} kcal, as your estimate.`,
  };
}
