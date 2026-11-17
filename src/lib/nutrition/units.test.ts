import { describe, expect, it } from "vitest";

import {
  PortionError,
  portionText,
  describePortion,
  pickDefaultServing,
  toGrams,
} from "@/lib/nutrition/units";

describe("toGrams", () => {
  it("passes grams through unchanged", () => {
    expect(toGrams({ amount: 200, unit: "g" })).toBe(200);
  });

  it("treats millilitres as grams by default", () => {
    expect(toGrams({ amount: 250, unit: "ml" })).toBe(250);
  });

  it("multiplies a serving by its gram weight", () => {
    // "2 × 1 medium banana", 118 g each.
    expect(
      toGrams({ amount: 2, unit: "serving", serving: { grams: 118 } }),
    ).toBe(236);
  });

  it("handles fractional servings", () => {
    expect(
      toGrams({ amount: 0.5, unit: "serving", serving: { grams: 240 } }),
    ).toBe(120);
  });

  it("refuses a serving amount with no serving attached", () => {
    // Guessing here would put a fabricated weight into the diary.
    expect(() => toGrams({ amount: 1, unit: "serving" })).toThrow(PortionError);
    expect(() =>
      toGrams({ amount: 1, unit: "serving", serving: { grams: 0 } }),
    ).toThrow(PortionError);
  });

  it("rejects non-positive and non-finite amounts", () => {
    expect(() => toGrams({ amount: 0, unit: "g" })).toThrow(PortionError);
    expect(() => toGrams({ amount: -5, unit: "g" })).toThrow(PortionError);
    expect(() => toGrams({ amount: Number.NaN, unit: "g" })).toThrow(
      PortionError,
    );
  });
});

describe("pickDefaultServing", () => {
  const servings = [
    { label: "1 g", grams: 1, is_default: false },
    { label: "1 medium", grams: 118, is_default: true },
  ];

  it("prefers the flagged default", () => {
    expect(pickDefaultServing(servings)?.label).toBe("1 medium");
  });

  it("falls back to the first when nothing is flagged", () => {
    const none = servings.map((s) => ({ ...s, is_default: false }));
    expect(pickDefaultServing(none)?.label).toBe("1 g");
  });

  it("returns null for an empty list", () => {
    expect(pickDefaultServing([])).toBeNull();
  });
});

describe("describePortion", () => {
  it("reads back a weight", () => {
    expect(describePortion(200, "g")).toBe("200 g");
  });

  it("reads back a serving with its label", () => {
    expect(describePortion(2, "serving", "1 medium")).toBe("2 × 1 medium");
  });

  it("falls back to a generic label", () => {
    expect(describePortion(1, "serving", "  ")).toBe("1 × serving");
  });

  it("trims trailing zeros", () => {
    expect(describePortion(1.5, "serving", "slice")).toBe("1.5 × slice");
    expect(describePortion(100.0, "g")).toBe("100 g");
  });
});

describe("portionText — one portion, said once", () => {
  it("does not repeat a serving that is only a weight", () => {
    expect(portionText(1, "serving", 100, "100 g")).toBe("100 g");
    expect(portionText(1.5, "serving", 150, "100g")).toBe("150 g");
  });
  it("keeps a real serving and what it weighed, which are complementary", () => {
    expect(portionText(1.5, "serving", 291, "portion")).toBe("1.5 × portion · 291 g");
    expect(portionText(1, "serving", 160, "pot")).toBe("1 pot · 160 g");
  });
  it("does not repeat a published label's own count and weight", () => {
    expect(portionText(1, "serving", 14, "1 portion (14 g)")).toBe("1 portion · 14 g");
    expect(portionText(2, "serving", 130, "1 portion (65 g)")).toBe("2 × portion · 130 g");
    expect(portionText(1, "serving", 281, "1 burger (281 g)")).toBe("1 burger · 281 g");
    expect(portionText(1, "serving", 245, '1 6" sub (245 g)')).toBe('1 6" sub · 245 g');
  });
  it("keeps a label's weight when no grams follow, and a real fraction", () => {
    expect(portionText(1, "serving", null, "1 burger (281 g)")).toBe("1 burger (281 g)");
    expect(portionText(2, "serving", 240, "1 1/2 cup")).toBe("2 × 1 1/2 cup · 240 g");
  });
  it("says grams once and millilitres once when they agree", () => {
    expect(portionText(180, "g", 180)).toBe("180 g");
    expect(portionText(250, "ml", 250)).toBe("250 ml");
    expect(portionText(250, "ml", 270)).toBe("250 ml · 270 g");
  });
});
