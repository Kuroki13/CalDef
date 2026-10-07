/**
 * A saved meal as a template, not a prescription (spec §12F).
 *
 * At log time each item can be left out or given a different amount — less
 * rice today, no yogurt — without editing the saved meal itself. The change
 * applies to this one log and nowhere else.
 *
 * An amount is always in the item's own unit (grams, millilitres, or its
 * serving), so the new portion is the stored one scaled: grams and macros in
 * proportion. The macros being scaled are the ones `getSavedMeal` has just
 * computed from the foods' nutrient rows, so nothing typed into the form
 * becomes a calorie figure except through that ratio.
 *
 * Pure, so the arithmetic is testable on its own.
 */

import { type MacroTotals, multiplyMacros } from "@/lib/nutrition/macros";

export type TemplateItem = {
  id: number;
  amount: number;
  grams: number;
  macros: MacroTotals;
};

export type ItemOverride = { include: boolean; amount: number };

export type MealOverrides = ReadonlyMap<number, ItemOverride>;

/** Round to the precision the columns hold. */
const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function applyOverrides<T extends TemplateItem>(
  items: readonly T[],
  overrides: MealOverrides | null,
): { items: T[] } | { error: string } {
  if (!overrides) return { items: [...items] };

  const out: T[] = [];
  for (const item of items) {
    const override = overrides.get(item.id);
    if (!override) {
      out.push(item);
      continue;
    }
    if (!override.include) continue;

    const amount = override.amount;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      return { error: "Each amount must be a number above zero." };
    }
    if (amount === item.amount) {
      out.push(item);
      continue;
    }

    const ratio = amount / item.amount;
    out.push({
      ...item,
      amount,
      grams: Math.max(round3(item.grams * ratio), 0.001),
      macros: multiplyMacros(item.macros, ratio),
    });
  }

  if (out.length === 0) return { error: "Tick at least one item to log." };
  return { items: out };
}

/**
 * Reads a template form: one `itemId` and `amount` per row, in order, and an
 * `include` per ticked row (its value the item id). A form with no `itemId`
 * at all means "as saved" — the plain form used before §12F still works.
 */
export function overridesFromForm(formData: FormData): MealOverrides | null {
  const ids = formData.getAll("itemId").map((v) => Number(v));
  if (ids.length === 0) return null;

  const amounts = formData.getAll("amount").map((v) => Number(String(v).trim() || NaN));
  const included = new Set(formData.getAll("include").map((v) => Number(v)));

  const overrides = new Map<number, ItemOverride>();
  ids.forEach((id, index) => {
    if (!Number.isInteger(id) || id <= 0) return;
    overrides.set(id, { include: included.has(id), amount: amounts[index] });
  });
  return overrides;
}
