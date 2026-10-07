/**
 * Reading a "log again" form.
 *
 * The form posts one `entryId` and one `amount` per row, in order, plus an
 * `include` for each row that is ticked (its value the entry id). Rows are
 * paired by position and kept only if ticked. A form for a single entry has
 * no checkboxes and sends `includeAll`, since there is nothing to choose.
 *
 * Pure, so it can be tested without a request.
 */

import { z } from "zod";

export const repeatTargetSchema = z.object({
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
});

export type ParsedRepeat =
  | {
      logDate: string;
      mealTypeId: number;
      items: { entryId: number; amount: number }[];
    }
  | { error: string };

export function parseRepeatForm(formData: FormData): ParsedRepeat {
  const target = repeatTargetSchema.safeParse({
    logDate: formData.get("logDate"),
    mealTypeId: formData.get("mealTypeId"),
  });
  if (!target.success) return { error: "Choose a day and a meal." };

  const ids = formData.getAll("entryId").map((v) => Number(v));
  const amounts = formData.getAll("amount").map((v) => Number(String(v).trim() || NaN));
  const includeAll = formData.get("includeAll") === "true";
  const included = new Set(formData.getAll("include").map((v) => Number(v)));

  const items: { entryId: number; amount: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const entryId = ids[i];
    if (!Number.isInteger(entryId) || entryId <= 0) continue;
    if (!includeAll && !included.has(entryId)) continue;

    const amount = amounts[i];
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      return { error: "Each amount must be a number above zero." };
    }
    items.push({ entryId, amount });
  }

  if (items.length === 0) return { error: "Tick at least one item to log." };
  return { ...target.data, items };
}
