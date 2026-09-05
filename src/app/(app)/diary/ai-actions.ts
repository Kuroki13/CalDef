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
import { logCachedFood } from "@/lib/food-log";

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
  }

  revalidatePath("/diary");
  revalidatePath("/dashboard");

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
