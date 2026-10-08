import { describe, expect, it } from "vitest";

import data from "@/lib/food/data/cnf.json";
import { cnfProvider, searchCnf } from "@/lib/food/cnf";
import { entryConfidence } from "@/lib/nutrition/confidence";

describe("CNF — Health Canada's own foods only (§13K)", () => {
  it("is the 2026 edition, open licence, and only the Canadian-original foods", () => {
    expect(data.licence).toMatch(/Open Government Licence – Canada/);
    expect(data.foods.length).toBe(1195);
  });

  it("finds the Canadian staples USDA lacks, in English or French", () => {
    // Peameal bacon is not here on purpose: CNF took it from USDA.
    for (const q of ["poutine", "tourtiere", "cretons", "tarte au sucre"]) {
      expect(searchCnf(q).length, q).toBeGreaterThan(0);
    }
    expect(searchCnf("tourtière")[0].name).toMatch(/tourti/i);
    expect(searchCnf("pâté tourtière")[0].name).toMatch(/^Pâté, tourtière/);
    expect(searchCnf("tourtiere pie")[0].name).toMatch(/^Pie, tourtiere/);
  });

  it("brings Health Canada's household measures as servings, in grams", () => {
    const [pie] = searchCnf("tourtiere commercial");
    expect(pie.servings[0]).toEqual({ label: "1 pie (20 cm dia)", grams: 450, isDefault: true });
    const [poutine] = searchCnf("poutine");
    // A real density: 250 ml of poutine weighs 165 g, not 250.
    expect(poutine.servings.find((s) => s.label === "250 ml")?.grams).toBe(165);
  });

  it("marks a recipe compilation unverified, so it reads as Estimated", () => {
    const [poutine] = searchCnf("poutine");
    expect(poutine.isVerified).toBe(false);
    expect(
      entryConfidence({
        isEstimate: false,
        food: { source: "cnf", isVerified: false, isRestaurantReference: false, basisUnit: "g" },
        recipe: null,
        unit: "g",
      }),
    ).toBe("estimated");
    const [cretons] = searchCnf("cretons");
    expect(cretons.isVerified).toBe(true);
  });

  it("answers as a provider that cannot be down", async () => {
    const result = await cnfProvider.search({ text: "poutine" });
    expect(result).toMatchObject({ ok: true, source: "cnf" });
  });
});
