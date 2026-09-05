import { describe, expect, it } from "vitest";

import { trustedFoodText } from "@/lib/llm/food-text";
import { unavailableProvider } from "@/lib/llm/unavailable";

const text = trustedFoodText("200g chicken");

describe("unavailableProvider", () => {
  it("answers every method with a typed failure, not a throw", async () => {
    const provider = unavailableProvider("disabled");

    const results = [
      await provider.parseFoods(text),
      await provider.parseCorrection(text, {
        description: text,
        amount: 200,
        unit: "g",
      }),
      await provider.answer(text, {}),
    ];

    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("disabled");
        // The message has to name the manual path, because that is the
        // fallback the app promises when the AI is off.
        expect(result.message).toContain("manually");
      }
    }
  });

  it("distinguishes the user's switch from a missing key", async () => {
    const disabled = await unavailableProvider("disabled").parseFoods(text);
    const unconfigured =
      await unavailableProvider("unconfigured").parseFoods(text);

    expect(disabled.ok).toBe(false);
    expect(unconfigured.ok).toBe(false);
    if (disabled.ok || unconfigured.ok) return;

    // One is fixable in settings, the other is not fixable by the user at
    // all. Collapsing them would send someone to the wrong place.
    expect(disabled.reason).toBe("disabled");
    expect(unconfigured.reason).toBe("unconfigured");
  });

  it("reports itself unavailable", () => {
    expect(unavailableProvider("disabled").isAvailable()).toBe(false);
    expect(unavailableProvider("unconfigured").isAvailable()).toBe(false);
  });
});
