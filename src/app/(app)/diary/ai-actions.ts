"use server";

/**
 * Logging the foods the assistant proposed.
 *
 * The proposals the user confirms are ordinary `Food` records that came from
 * USDA, Open Food Facts or the cache — the model contributed a search term
 * and a portion, nothing else. So this action does exactly what the manual
 * one does: cache the food, then write the entry through `logCachedFood`,
 * which recomputes the macros from the stored nutrient row.
 *
 * The only difference that reaches the database is `source: "ai"`, which
 * records how the entry was created.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { cacheFood } from "@/lib/food/cache";
import { foodPayloadSchema } from "@/lib/food/payload";
import type { Food } from "@/lib/food/types";
import { logCachedFood, updateEntryPortion } from "@/lib/food-log";
import { getUserId } from "@/lib/supabase/server";

export type AiLogState = { error?: string; ok?: boolean; notice?: string };

const itemSchema = z.object({
  food: foodPayloadSchema,
  amount: z.coerce.number().positive().max(100000),
  unit: z.enum(["g", "ml", "serving"]),
  servingLabel: z.string().trim().max(120).nullable().optional(),
});

const payloadSchema = z.object({
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
  // A sentence rarely names more than a handful of foods; the cap stops a
  // crafted payload from turning one confirmation into a thousand writes.
  items: z.array(itemSchema).min(1).max(20),
});

export async function logParsedFoods(
  _prev: AiLogState,
  formData: FormData,
): Promise<AiLogState> {
  if (!await getUserId()) return { error: "Please sign in before logging food." };
  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(
      JSON.parse(String(formData.get("payload") ?? "")),
    );
  } catch {
    return { error: "Those entries could not be read. Try describing it again." };
  }

  const failures: string[] = [];
  let logged = 0;

  // Sequential rather than concurrent: each item caches a food, and two
  // items naming the same food would otherwise race to insert it.
  for (const item of payload.items) {
    try {
      const foodId = await cacheFood(item.food as Food);
      const result = await logCachedFood({
        foodId,
        logDate: payload.logDate,
        mealTypeId: payload.mealTypeId,
        amount: item.amount,
        unit: item.unit,
        servingLabel: item.servingLabel ?? null,
        source: "ai",
      });
      if ("error" in result) failures.push(item.food.name);
      else logged += 1;
    } catch {
      failures.push(item.food.name);
    }
  }

  revalidatePath("/diary");
  revalidatePath("/dashboard");
  revalidatePath("/assistant");

  if (logged === 0) {
    return { error: "Nothing could be logged. Add it from the search box." };
  }

  // A partial success is reported as one: saying "added" while an item was
  // silently dropped would leave a meal short without the user knowing.
  return failures.length === 0
    ? { ok: true, notice: `Added ${logged} item${logged === 1 ? "" : "s"}.` }
    : {
        ok: true,
        notice: `Added ${logged}. Could not add: ${failures.join(", ")}.`,
      };
}

/** Save the selected foods without creating any diary entries. */
export async function saveParsedFoods(
  _prev: AiLogState,
  formData: FormData,
): Promise<AiLogState> {
  if (!await getUserId()) return { error: "Please sign in before saving food." };
  let items: z.infer<typeof itemSchema>[];
  try {
    items = z.object({ items: z.array(itemSchema).min(1).max(20) }).parse(
      JSON.parse(String(formData.get("payload") ?? "")),
    ).items;
  } catch {
    return { error: "Those foods could not be read. Try again." };
  }
  let saved = 0;
  const failures: string[] = [];
  for (const item of items) {
    try {
      await cacheFood(item.food as Food);
      saved += 1;
    } catch {
      failures.push(item.food.name);
    }
  }
  revalidatePath("/recipes");
  revalidatePath("/assistant");
  if (!saved) return { error: "No foods could be saved. Please try again." };
  return {
    ok: true,
    notice: `Saved ${saved} food${saved === 1 ? "" : "s"} for reuse. Nothing was added to your diary.${failures.length ? ` Could not save: ${failures.join(", ")}.` : ""}`,
  };
}

const correctionSchema = z.object({
  entryId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().max(100000),
  unit: z.enum(["g", "ml", "serving"]),
});

/**
 * Applies a correction the user has read and confirmed.
 *
 * Takes the amount and unit rather than a model response: by this point the
 * proposal has been shown on screen with the calorie figure it would
 * produce, so what is applied is what was agreed to. `updateEntryPortion`
 * recomputes from the stored nutrient row, exactly as the manual edit does.
 */
export async function applyCorrection(
  _prev: AiLogState,
  formData: FormData,
): Promise<AiLogState> {
  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That change could not be applied." };

  const result = await updateEntryPortion({
    entryId: parsed.data.entryId,
    amount: parsed.data.amount,
    unit: parsed.data.unit,
  });
  if ("error" in result) return result;

  revalidatePath("/diary");
  revalidatePath("/dashboard");
  return { ok: true, notice: "Entry updated." };
}
