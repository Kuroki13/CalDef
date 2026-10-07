import { describe, expect, it } from "vitest";

import { checkQuickAdd, macroKcal, quickAddSchema } from "@/lib/quick-add-input";

const raw = (over: Record<string, string> = {}) => ({
  logDate: "2026-10-07",
  mealTypeId: "3",
  label: "Dinner out",
  kcal: "750",
  protein_g: "45",
  carbs_g: "",
  fat_g: "",
  ...over,
});

const parse = (r: Record<string, string>) => {
  const result = quickAddSchema.safeParse(r);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
};

describe("quickAddSchema", () => {
  it("takes the spec's example, with blank macros as zero", () => {
    expect(parse(raw())).toMatchObject({ label: "Dinner out", kcal: 750, protein_g: 45, carbs_g: 0, fat_g: 0 });
  });

  it("needs a label and calories", () => {
    expect(quickAddSchema.safeParse(raw({ label: "  " })).success).toBe(false);
    expect(quickAddSchema.safeParse(raw({ kcal: "" })).success).toBe(false);
    expect(quickAddSchema.safeParse(raw({ kcal: "0" })).success).toBe(false);
  });

  it("refuses more than the database's cap in one estimate", () => {
    expect(quickAddSchema.safeParse(raw({ kcal: "5001" })).success).toBe(false);
    expect(quickAddSchema.safeParse(raw({ kcal: "5000" })).success).toBe(true);
  });
});

describe("checkQuickAdd", () => {
  it("accepts macros that account for less than the calories — only protein known", () => {
    expect(checkQuickAdd(parse(raw()))).toBeNull();
  });

  it("refuses macros that need clearly more energy than was entered", () => {
    const input = parse(raw({ kcal: "300", protein_g: "100" }));
    expect(macroKcal(input)).toBe(400);
    expect(checkQuickAdd(input)).toMatch(/about 400 kcal, more than the 300/);
  });

  it("allows a label's rounding", () => {
    // 4·20 + 4·30 + 9·10 = 290 against a printed 270: rounding, not a mistake.
    expect(checkQuickAdd(parse(raw({ kcal: "270", protein_g: "20", carbs_g: "30", fat_g: "10" })))).toBeNull();
  });
});
