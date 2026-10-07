import { describe, expect, it } from "vitest";

import { applyOverrides, overridesFromForm } from "@/lib/meal-template";

const rice = { id: 1, amount: 200, grams: 200, macros: { kcal: 260, protein_g: 5.4, carbs_g: 56, fat_g: 0.6 } };
const yogurt = { id: 2, amount: 1, grams: 160, macros: { kcal: 115, protein_g: 16, carbs_g: 6.4, fat_g: 0.3 } };

describe("applyOverrides", () => {
  it("logs the meal as saved when nothing is changed", () => {
    expect(applyOverrides([rice, yogurt], null)).toEqual({ items: [rice, yogurt] });
  });

  it("scales grams and macros with a new amount in the item's own unit", () => {
    const result = applyOverrides([rice, yogurt], new Map([[1, { include: true, amount: 150 }]]));
    if ("error" in result) throw new Error(result.error);
    expect(result.items[0]).toEqual({
      id: 1,
      amount: 150,
      grams: 150,
      macros: { kcal: 195, protein_g: 4.05, carbs_g: 42, fat_g: 0.45 },
    });
    expect(result.items[1]).toBe(yogurt);
  });

  it("scales a serving by count: two pots is twice the grams", () => {
    const result = applyOverrides([yogurt], new Map([[2, { include: true, amount: 2 }]]));
    if ("error" in result) throw new Error(result.error);
    expect(result.items[0]).toMatchObject({ amount: 2, grams: 320, macros: { kcal: 230 } });
  });

  it("leaves out an unticked item", () => {
    const result = applyOverrides([rice, yogurt], new Map([[2, { include: false, amount: 1 }]]));
    expect(result).toEqual({ items: [rice] });
  });

  it("refuses to log nothing, and refuses an amount that is not one", () => {
    expect(applyOverrides([rice], new Map([[1, { include: false, amount: 200 }]]))).toEqual({
      error: "Tick at least one item to log.",
    });
    expect("error" in applyOverrides([rice], new Map([[1, { include: true, amount: Number.NaN }]]))).toBe(true);
  });
});

describe("overridesFromForm", () => {
  it("pairs rows by position and records which are ticked", () => {
    const form = new FormData();
    form.append("itemId", "1"); form.append("amount", "150");
    form.append("itemId", "2"); form.append("amount", "1");
    form.append("include", "1");
    expect(overridesFromForm(form)).toEqual(
      new Map([
        [1, { include: true, amount: 150 }],
        [2, { include: false, amount: 1 }],
      ]),
    );
  });

  it("means 'as saved' when the form has no item rows", () => {
    expect(overridesFromForm(new FormData())).toBeNull();
  });
});
