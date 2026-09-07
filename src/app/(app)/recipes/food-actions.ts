"use server";

/**
 * Creating, editing and retiring a user's own foods.
 *
 * One action saves both a new food and an edit, because the form is the
 * same form: a `foodId` in the payload is what distinguishes "this is the
 * bar I just bought" from "the label said 12 g of protein, not 21".
 *
 * The saved food comes back in the result so the diary can log it straight
 * away. Someone adds a food because they are holding the packet, and making
 * them go and search for what they just typed would be a strange thing to
 * do to them.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createCustomFood,
  deleteCustomFood,
  restoreCustomFood,
  updateCustomFood,
} from "@/lib/food/custom";
import { customFoodInputSchema } from "@/lib/food/custom-input";
import type { CachedFood } from "@/lib/food/types";

export type CustomFoodState = {
  error?: string;
  ok?: boolean;
  notice?: string;
  /** The saved food, so a caller can log it without searching for it. */
  food?: CachedFood;
};

function revalidateAll(): void {
  revalidatePath("/recipes");
  revalidatePath("/diary");
  revalidatePath("/dashboard");
}

const saveSchema = z.object({
  foodId: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.coerce.number().int().positive().nullable(),
    )
    .optional()
    .default(null),
});

export async function saveCustomFoodAction(
  _prev: CustomFoodState,
  formData: FormData,
): Promise<CustomFoodState> {
  const raw = Object.fromEntries(formData);

  const target = saveSchema.safeParse(raw);
  if (!target.success) return { error: "That food could not be identified." };

  const parsed = customFoodInputSchema.safeParse(raw);
  if (!parsed.success) {
    // The first issue, in the words the schema gave it: these are all
    // "what you typed is not a number / not a barcode" problems, and the
    // field is named in the message.
    return { error: firstMessage(parsed.error) };
  }

  const saved =
    target.data.foodId === null
      ? await createCustomFood(parsed.data)
      : await updateCustomFood(target.data.foodId, parsed.data);

  if ("error" in saved) return { error: saved.error };

  revalidateAll();
  return {
    ok: true,
    food: saved.food,
    notice:
      target.data.foodId === null
        ? `${saved.food.name} is now one of your foods.`
        : `${saved.food.name} updated. Entries already in your diary keep the numbers they were logged with.`,
  };
}

const deleteSchema = z.object({
  foodId: z.coerce.number().int().positive(),
});

export async function deleteCustomFoodAction(
  _prev: CustomFoodState,
  formData: FormData,
): Promise<CustomFoodState> {
  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That food could not be identified." };

  const outcome = await deleteCustomFood(parsed.data.foodId);
  if ("error" in outcome) return { error: outcome.error };

  revalidateAll();

  if ("archived" in outcome) {
    const times = outcome.useCount === 1 ? "once" : `${outcome.useCount} times`;
    return {
      ok: true,
      notice:
        `Removed from your foods. It was already used ${times}, so the ` +
        `record is kept and those entries are unchanged.`,
    };
  }

  return { ok: true, notice: "Deleted." };
}

/**
 * Puts a retired food back in the library.
 *
 * Archiving was a one-way door: the row survived so that history kept
 * resolving, but nothing could bring it back, so a mistaken "Remove" was
 * permanent in practice while being reversible in the database. This is the
 * one `update` that undoes it.
 */
export async function restoreCustomFoodAction(
  _prev: CustomFoodState,
  formData: FormData,
): Promise<CustomFoodState> {
  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That food could not be identified." };

  const outcome = await restoreCustomFood(parsed.data.foodId);
  if ("error" in outcome) return { error: outcome.error };

  revalidateAll();
  return { ok: true, notice: "Back in your foods, and in search." };
}

/** The first validation message, with the field named where zod named it. */
function firstMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue.path.join(".");
  const named: Record<string, string> = {
    name: "Give the food a name.",
    barcode: "A barcode is 6 to 14 digits.",
    servingGrams: "Say what one serving weighs, so the figures can be scaled.",
    kcal: "Calories must be a number, and not negative.",
    protein_g: "Protein must be a number, and not negative.",
    carbs_g: "Carbohydrate must be a number, and not negative.",
    fat_g: "Fat must be a number, and not negative.",
  };
  return named[field] ?? "Check the figures you entered.";
}
