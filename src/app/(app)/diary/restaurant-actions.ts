"use server";

/**
 * Logs a restaurant order built from official parts (spec §13M).
 *
 * Five Guys publishes components, not assembled burgers, so a burger is
 * logged as what it is: a bun, patties, cheese, toppings — each its own
 * diary entry with the chain's published figures. Every part is exact; no
 * official base is ever combined with an estimated addition.
 *
 * Only catalogue identities are trusted. The browser sends slugs and counts;
 * every figure comes from the stored catalogue and the normal logging path.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { cacheFood } from "@/lib/food/cache";
import { restaurantById } from "@/lib/food/restaurant-catalogue";
import { logCachedFood } from "@/lib/food-log";

export type PartsState = { error?: string; ok?: boolean; notice?: string };

const MAX_PARTS = 25;

const schema = z.object({
  chain: z.literal("fiveguys"),
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
});

export async function logRestaurantPartsAction(
  _prev: PartsState,
  formData: FormData,
): Promise<PartsState> {
  const parsed = schema.safeParse({
    chain: formData.get("chain"),
    logDate: formData.get("logDate"),
    mealTypeId: formData.get("mealTypeId"),
  });
  if (!parsed.success) return { error: "Choose a day and a meal." };

  const parts: { slug: string; count: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("part:")) continue;
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0 || count > 10) {
      return { error: "Each part's count must be a whole number from 0 to 10." };
    }
    if (count > 0) parts.push({ slug: key.slice(5), count });
  }
  if (parts.length === 0) return { error: "Choose at least one part." };
  if (parts.length > MAX_PARTS) return { error: "Too many parts." };

  let logged = 0;
  for (const part of parts) {
    const food = restaurantById(`restaurant:${parsed.data.chain}:${part.slug}`);
    if (!food) return { error: "One of those parts is not on the official sheet." };
    // Saves the reference as the user's own copy (as any restaurant item),
    // then logs it through the one path that computes figures.
    const foodId = await cacheFood(food);
    const result = await logCachedFood({
      foodId,
      logDate: parsed.data.logDate,
      mealTypeId: parsed.data.mealTypeId,
      amount: part.count,
      unit: "serving",
      servingLabel: food.servings[0].label,
      source: "manual",
    });
    if ("error" in result) {
      return { error: `${logged} part${logged === 1 ? "" : "s"} logged, then: ${result.error}` };
    }
    logged += 1;
  }

  revalidatePath("/diary");
  revalidatePath("/dashboard");
  return { ok: true, notice: `Logged ${logged} part${logged === 1 ? "" : "s"} from Five Guys.` };
}
