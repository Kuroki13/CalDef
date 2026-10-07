/**
 * Reading a Quick Add (spec §12G): "Dinner out — 750 kcal, 45 g protein".
 *
 * The one place in the app where the user types a calorie figure straight
 * into the diary. That is allowed because it is labelled for what it is — the
 * user's own estimate — and never becomes a food. What this module guards is
 * that the numbers are at least internally possible.
 *
 * Pure, so the rules are testable on their own.
 */

import { z } from "zod";

/** The database's cap on a single estimate (migration 0014). */
export const QUICK_ADD_MAX_KCAL = 5000;

const optionalGrams = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : v),
  z.coerce.number().min(0).max(1000),
);

export const quickAddSchema = z.object({
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
  label: z.string().trim().min(1, "Say what it was.").max(120),
  kcal: z.coerce
    .number({ message: "Enter the calories." })
    .positive("Enter the calories.")
    .max(QUICK_ADD_MAX_KCAL, `One estimate can be at most ${QUICK_ADD_MAX_KCAL} kcal.`),
  protein_g: optionalGrams,
  carbs_g: optionalGrams,
  fat_g: optionalGrams,
});

export type QuickAddInput = z.infer<typeof quickAddSchema>;

/** Energy the macros account for, at the usual 4 / 4 / 9. */
export function macroKcal(input: Pick<QuickAddInput, "protein_g" | "carbs_g" | "fat_g">): number {
  return input.protein_g * 4 + input.carbs_g * 4 + input.fat_g * 9;
}

/**
 * Refuses macros that need clearly more energy than the calories given.
 *
 * "300 kcal, 100 g protein" is 400 kcal of protein alone, so one of the two
 * numbers is wrong, and logging both would put a contradiction in the
 * diary. Some slack is allowed — fibre, rounding, and labels that round
 * each figure — so only a real mismatch is refused. Macros adding up to
 * *less* than the calories are normal: the user may know only the protein.
 */
export function checkQuickAdd(input: QuickAddInput): string | null {
  const fromMacros = macroKcal(input);
  if (fromMacros > input.kcal * 1.15 + 20) {
    return `Those macros come to about ${Math.round(fromMacros)} kcal, more than the ${Math.round(input.kcal)} kcal entered. Check one of them.`;
  }
  return null;
}
