import { describe, expect, it } from "vitest";

import {
  customFoodInputSchema,
  normaliseCustomFood,
} from "@/lib/food/custom-input";

/** What a form actually posts: every value a string. */
const label = (over: Record<string, string> = {}) => ({
  name: "Protein flapjack",
  basis: "per_100g",
  servingGrams: "",
  kcal: "400",
  protein_g: "20",
  carbs_g: "45",
  fat_g: "12",
  ...over,
});

function parse(raw: Record<string, string>) {
  const result = customFoodInputSchema.safeParse(raw);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}

describe("customFoodInputSchema — what a form sends", () => {
  it("coerces the numbers a form posts as strings", () => {
    const input = parse(label());
    expect(input.kcal).toBe(400);
    expect(input.protein_g).toBe(20);
  });

  it("treats a blank optional field as absent, not as zero", () => {
    // "The packet does not say" and "the packet says none" are different
    // claims, and a food with no fibre figure must not read as 0 g fibre.
    const input = parse(label({ fiber_g: "", sugar_g: "" }));
    expect(input.fiber_g).toBeNull();
    expect(input.sugar_g).toBeNull();
  });

  it("requires a serving weight when the figures are per serving", () => {
    const result = customFoodInputSchema.safeParse(
      label({ basis: "per_serving", servingGrams: "" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a barcode of the length the column accepts, and no other", () => {
    expect(customFoodInputSchema.safeParse(label({ barcode: "3017624010701" })).success).toBe(true);
    expect(customFoodInputSchema.safeParse(label({ barcode: "12345" })).success).toBe(false);
    expect(customFoodInputSchema.safeParse(label({ barcode: "abc123456" })).success).toBe(false);
    // Blank means "no barcode", which is the common case.
    expect(customFoodInputSchema.safeParse(label({ barcode: "" })).success).toBe(true);
  });

  it("refuses a nameless food", () => {
    expect(customFoodInputSchema.safeParse(label({ name: "   " })).success).toBe(
      false,
    );
  });
});

describe("normaliseCustomFood — per 100 g, whatever the packet said", () => {
  it("passes per-100 g figures through untouched", () => {
    const result = normaliseCustomFood(parse(label()));
    if ("error" in result) throw new Error(result.error);

    expect(result.nutrients).toMatchObject({
      kcal: 400,
      protein_g: 20,
      carbs_g: 45,
      fat_g: 12,
    });
  });

  it("scales a per-serving panel to per 100 g", () => {
    // A 45 g bar with 200 kcal is 444.44 kcal per 100 g. This is the
    // arithmetic nobody should be doing in their head at a supermarket.
    const result = normaliseCustomFood(
      parse(
        label({
          basis: "per_serving",
          servingGrams: "45",
          kcal: "200",
          protein_g: "10",
          carbs_g: "22.5",
          fat_g: "6",
        }),
      ),
    );
    if ("error" in result) throw new Error(result.error);

    expect(result.nutrients.kcal).toBe(444.44);
    expect(result.nutrients.protein_g).toBe(22.22);
    expect(result.nutrients.carbs_g).toBe(50);
    expect(result.nutrients.fat_g).toBe(13.33);
  });

  it("leaves an absent figure absent rather than scaling a zero into it", () => {
    const result = normaliseCustomFood(
      parse(label({ basis: "per_serving", servingGrams: "45", fiber_g: "" })),
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.nutrients.fiber_g).toBeNull();
  });

  it("keeps a serving so the food can be logged by portion", () => {
    const result = normaliseCustomFood(
      parse(label({ servingGrams: "45", servingLabel: "1 bar" })),
    );
    if ("error" in result) throw new Error(result.error);

    expect(result.servings).toEqual([
      { label: "1 bar", grams: 45, isDefault: true },
    ]);
  });

  it("names an unnamed serving by its weight", () => {
    const result = normaliseCustomFood(parse(label({ servingGrams: "45" })));
    if ("error" in result) throw new Error(result.error);
    expect(result.servings[0].label).toBe("1 serving (45 g)");
  });

  it("has no serving at all when none was given", () => {
    const result = normaliseCustomFood(parse(label()));
    if ("error" in result) throw new Error(result.error);
    expect(result.servings).toEqual([]);
  });

  it("checks the caps after conversion, not before", () => {
    // 20 g of protein in a 45 g serving is an ordinary bar. In a 5 g
    // serving it would be 400 g of protein per 100 g, which is not a food —
    // and the column would reject it with a constraint violation the user
    // could make nothing of.
    const ordinary = normaliseCustomFood(
      parse(label({ basis: "per_serving", servingGrams: "45", protein_g: "20" })),
    );
    expect("error" in ordinary).toBe(false);

    const impossible = normaliseCustomFood(
      parse(
        // Calories kept low enough that protein is the figure that fails,
        // so the message under test is the one being checked.
        label({
          basis: "per_serving",
          servingGrams: "5",
          kcal: "40",
          protein_g: "20",
        }),
      ),
    );
    if (!("error" in impossible)) throw new Error("expected a rejection");
    expect(impossible.error).toMatch(/Protein/);
    expect(impossible.error).toMatch(/400 per 100 g/);
  });

  it("rejects calories no food can reach", () => {
    const result = normaliseCustomFood(parse(label({ kcal: "1200" })));
    if (!("error" in result)) throw new Error("expected a rejection");
    expect(result.error).toMatch(/Calories cannot exceed 1000 per 100 g/);
  });

  it("allows pure fat, which is nearly the cap", () => {
    // Olive oil is 884 kcal and 100 g of fat per 100 g. The limits have to
    // admit the most extreme real food or they are wrong.
    const result = normaliseCustomFood(
      parse(label({ kcal: "884", protein_g: "0", carbs_g: "0", fat_g: "100" })),
    );
    expect("error" in result).toBe(false);
  });
});
