import { describe, expect, it } from "vitest";

import {
  PortionError,
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
