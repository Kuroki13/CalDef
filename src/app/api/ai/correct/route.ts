import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { trustedFoodText, toFoodText } from "@/lib/llm/food-text";
import { llmForCurrentUser } from "@/lib/llm";
import { scaleNutrients } from "@/lib/nutrition/macros";
import { toGrams } from "@/lib/nutrition/units";
import { RATE_LIMITS, rateLimitAll, rateLimitHeaders } from "@/lib/rate-limit";
import { createClient, getUserId } from "@/lib/supabase/server";

/**
 * "Actually that was 250g, not 200g."
 *
 * Like the parse route, this proposes and does not write: it returns what
 * the change would do, and the ordinary edit and delete actions apply it.
 * A model that misreads a sentence must not be able to silently rewrite a
 * diary entry, and an unclear reading is reported as unclear rather than
 * resolved into a guess.
 *
 * What crosses the boundary is the food's name and its portion, as a
 * sentence. The entry id, the user id and the stored macros stay here.
 */

const bodySchema = z.object({
  entryId: z.coerce.number().int().positive(),
  text: z.string().max(2000),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Two buckets: this route's own, and the one every Gemini call shares.
  // Without the second, three routes at 10/min each could make 30 requests a
  // minute against a model whose free tier allows 15.
  const limit = rateLimitAll([
    { key: `ai-correct:${userId}`, options: RATE_LIMITS.ai },
    { key: `gemini:${userId}`, options: RATE_LIMITS.gemini },
  ]);
  const headers = rateLimitHeaders(limit.result, limit.limit);
  if (!limit.allowed) {
    // `reason` distinguishes our own limiter from the provider's, which also
    // answers 429 — see the note on `rate-limited` in lib/llm/types.ts.
    return NextResponse.json(
      {
        error: "Too many requests. Try again shortly.",
        reason: "too-many-requests",
      },
      { status: 429, headers },
    );
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Say what should change." },
      { status: 400, headers },
    );
  }

  const text = toFoodText(body.data.text);
  if (!text.ok) {
    return NextResponse.json(
      { error: text.message, reason: text.reason },
      { status: 400, headers },
    );
  }

  const supabase = await createClient();
  // RLS scopes this to the caller, so a guessed id finds nothing.
  const { data: entry } = await supabase
    .from("food_logs")
    .select(
      `id, amount, unit, grams, kcal, food_id,
       foods ( name, brand, food_nutrients ( kcal, protein_g, carbs_g, fat_g ) ),
       food_servings ( label, grams )`,
    )
    .eq("id", body.data.entryId)
    .maybeSingle();

  if (!entry) {
    return NextResponse.json(
      { error: "That entry no longer exists." },
      { status: 404, headers },
    );
  }
  if (!entry.foods) {
    return NextResponse.json(
      { error: "Edit a recipe entry from the recipe itself." },
      { status: 400, headers },
    );
  }

  const llm = await llmForCurrentUser();
  const parsed = await llm.parseCorrection(text.value, {
    // The food's own name, which came from a provider and is not user text.
    description: trustedFoodText(
      entry.foods.brand
        ? `${entry.foods.name} (${entry.foods.brand})`
        : entry.foods.name,
    ),
    amount: Number(entry.amount),
    unit: entry.unit,
  });

  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.message, reason: parsed.reason },
      { status: parsed.reason === "rate-limited" ? 429 : 503, headers },
    );
  }

  const intent = parsed.value;

  if (intent.kind !== "amount") {
    // "remove" and "unclear" both need no arithmetic; the client shows the
    // delete control for one and an explanation for the other.
    return NextResponse.json({ intent }, { headers });
  }

  // The preview is computed here, from the stored nutrient row — the same
  // source the update itself will use, so what the user confirms is what
  // they get.
  const nutrients = entry.foods.food_nutrients;
  const serving = entry.food_servings;

  let preview: { grams: number; kcal: number } | null = null;
  if (nutrients) {
    try {
      const grams = toGrams({
        amount: intent.amount,
        unit: intent.unit,
        serving:
          intent.unit === "serving" && serving
            ? { grams: Number(serving.grams) }
            : null,
      });
      preview = {
        grams,
        kcal: scaleNutrients(
          {
            kcal: Number(nutrients.kcal),
            protein_g: Number(nutrients.protein_g),
            carbs_g: Number(nutrients.carbs_g),
            fat_g: Number(nutrients.fat_g),
          },
          grams,
        ).kcal,
      };
    } catch {
      // A serving amount with no serving to measure. Reported as no preview
      // rather than a fabricated weight.
      preview = null;
    }
  }

  return NextResponse.json(
    {
      intent,
      preview,
      current: {
        amount: Number(entry.amount),
        unit: entry.unit,
        kcal: Number(entry.kcal),
        name: entry.foods.name,
      },
    },
    { headers },
  );
}
