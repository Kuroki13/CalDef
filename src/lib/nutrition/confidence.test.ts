import { describe, expect, it } from "vitest";

import { type EntryProvenance, entryConfidence, estimatedShare } from "@/lib/nutrition/confidence";

const food = (over: Partial<NonNullable<EntryProvenance["food"]>> = {}) => ({
  source: "usda" as const,
  isVerified: true,
  isRestaurantReference: false,
  basisUnit: "g" as const,
  ...over,
});

const entry = (over: Partial<EntryProvenance> = {}): EntryProvenance => ({
  isEstimate: false,
  food: food(),
  recipe: null,
  unit: "g",
  ...over,
});

describe("entryConfidence — the spec's four levels", () => {
  it("calls the user's own label, a restaurant item and a built recipe exact", () => {
    expect(entryConfidence(entry({ food: food({ source: "custom", isVerified: false }) }))).toBe("exact");
    expect(entryConfidence(entry({ food: food({ source: "custom", isRestaurantReference: true }) }))).toBe("exact");
    expect(entryConfidence(entry({ food: null, recipe: { aiDrafted: false }, unit: "serving" }))).toBe("exact");
  });

  it("calls USDA's analysed data and a branded label strong", () => {
    expect(entryConfidence(entry())).toBe("strong");
    expect(entryConfidence(entry({ food: food({ source: "off", isVerified: false }) }))).toBe("strong");
  });

  it("calls an assumed portion estimated", () => {
    expect(entryConfidence(entry({ food: null, recipe: { aiDrafted: true }, unit: "serving" }))).toBe("estimated");
    // Olive oil poured at 1 g/ml.
    expect(entryConfidence(entry({ unit: "ml" }))).toBe("estimated");
  });

  it("does not doubt a drink poured in millilitres, which is how its label reads", () => {
    expect(entryConfidence(entry({ unit: "ml", food: food({ source: "custom", basisUnit: "ml" }) }))).toBe("exact");
  });

  it("calls a Quick Add rough", () => {
    expect(entryConfidence(entry({ isEstimate: true, food: null }))).toBe("rough");
  });
});

describe("estimatedShare", () => {
  it("is the share of calories that are estimated or rough", () => {
    expect(
      estimatedShare([
        { kcal: 1500, confidence: "strong" },
        { kcal: 300, confidence: "exact" },
        { kcal: 450, confidence: "rough" },
        { kcal: 150, confidence: "estimated" },
      ]),
    ).toBeCloseTo(0.25);
  });

  it("is null for an empty day, not zero", () => {
    expect(estimatedShare([])).toBeNull();
  });
});
