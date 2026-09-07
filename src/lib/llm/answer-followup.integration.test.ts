import { expect, it } from "vitest";

import { trustedFoodText } from "@/lib/llm/food-text";
import { geminiProvider } from "@/lib/llm/gemini";

/**
 * A follow-up, against the real model.
 *
 * The unit tests prove the earlier turns reach the prompt and that only food
 * text does. What they cannot show is the thing the feature is for: that
 * "and how much protein was that?" — a sentence naming no food — comes back
 * as an answer about the food in the turn before it. That is a claim about a
 * model, so it is checked against one.
 *
 * Opt-in with `npm run test:live`, and paced like the rest of that suite:
 * two Gemini calls, seven seconds apart, against a free-tier quota measured
 * in requests per minute.
 */
it("answers a follow-up using the turn before it", async () => {
  const first = await geminiProvider.answer(
    trustedFoodText("how many calories in 100 g of chicken breast?"),
    { targetCalories: 2250 },
  );
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  await new Promise((r) => setTimeout(r, 7000));

  const follow = await geminiProvider.answer(
    trustedFoodText("and how much protein was that?"),
    { targetCalories: 2250 },
    [
      {
        role: "user",
        text: trustedFoodText("how many calories in 100 g of chicken breast?"),
      },
      { role: "assistant", text: trustedFoodText(first.value) },
    ],
  );

  expect(follow.ok).toBe(true);
  if (!follow.ok) return;

  // The question never says "chicken" or "protein of what". Answering it at
  // all is the thing being verified.
  expect(follow.value).toMatch(/protein/i);
  expect(follow.value).toMatch(/chicken|breast|it\b/i);
  expect(follow.value).not.toMatch(/what (food|are you referring)/i);
}, 60000);
