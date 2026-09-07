import { describe, expect, it } from "vitest";

import { trustedFoodText } from "@/lib/llm/food-text";
import { geminiProvider } from "@/lib/llm/gemini";

/**
 * Drafting a dish, against the real model.
 *
 * The unit tests prove that a calorie figure in a response has nowhere to go.
 * What they cannot show is whether a real model, asked this question, returns
 * something a food database can actually resolve — a list of plain
 * ingredients rather than a paragraph, a recipe method, or a helpful table of
 * nutrition. That is a claim about a model, so it is checked against one.
 *
 * Opt-in with `npm run test:live`, and paced like the rest of that suite.
 */
describe("draftRecipe against Gemini", () => {
  it("returns plain ingredients and amounts for a home-cooked dish", async () => {
    const result = await geminiProvider.draftRecipe(
      trustedFoodText("chicken maqlouba"),
    );
    if (!result.ok) throw new Error(`drafting failed: ${result.reason}`);

    const { foods } = result.value;
    expect(foods.length).toBeGreaterThan(2);

    for (const intent of foods) {
      // The shape the resolver needs, and only that shape.
      expect(Object.keys(intent).sort()).toEqual(["amount", "query", "unit"]);
      expect(intent.query.length).toBeGreaterThan(1);
      expect(intent.amount).toBeGreaterThan(0);
      expect(["g", "ml", "serving"]).toContain(intent.unit);
    }

    // The dish is chicken and rice; if neither appears, the model answered a
    // different question and the prompt is wrong.
    const named = foods.map((f) => f.query.toLowerCase()).join(" ");
    expect(named).toMatch(/chicken/);
    expect(named).toMatch(/rice/);

    // Nothing anywhere in the result resembles a nutrition figure.
    expect(JSON.stringify(result.value)).not.toMatch(/kcal|calorie|protein/i);
  }, 60000);
});
