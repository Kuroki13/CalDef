import { describe, expect, it } from "vitest";

import {
  USUAL_MIN_LOGS,
  type PortionLog,
  roundUsual,
  typicalPortion,
} from "@/lib/nutrition/typical-portion";

const g = (amount: number): PortionLog => ({ amount, unit: "g", servingLabel: null });
const pot = (amount: number, label = "1 pot"): PortionLog => ({
  amount,
  unit: "serving",
  servingLabel: label,
});

describe("typicalPortion", () => {
  it("reads 178, 192, 185, 181 as about 185 g (the spec's example)", () => {
    expect(typicalPortion([g(178), g(192), g(185), g(181)])).toEqual({
      amount: 185,
      unit: "g",
      servingLabel: null,
      basedOn: 4,
    });
  });

  it("offers nothing until it is a habit", () => {
    expect(USUAL_MIN_LOGS).toBe(3);
    expect(typicalPortion([g(180), g(190)])).toBeNull();
    expect(typicalPortion([])).toBeNull();
  });

  it("is not dragged by one odd day, because it is a median", () => {
    expect(typicalPortion([g(180), g(600), g(185), g(175)])?.amount).toBe(185);
  });

  it("follows the unit used most, and never averages pots with grams", () => {
    const result = typicalPortion([pot(1), g(200), pot(2), pot(1), g(150)]);
    expect(result).toEqual({ amount: 1, unit: "serving", servingLabel: "1 pot", basedOn: 3 });
  });

  it("keeps two different servings apart", () => {
    expect(typicalPortion([pot(1, "1 pot"), pot(1, "1 spoon"), pot(1, "1 pot"), pot(1, "1 spoon")])).toBeNull();
  });

  it("looks only at the latest ten, so a changed habit wins", () => {
    const now = Array.from({ length: 10 }, () => g(250));
    const before = Array.from({ length: 20 }, () => g(100));
    expect(typicalPortion([...now, ...before])?.amount).toBe(250);
  });
});

describe("roundUsual", () => {
  it("rounds to what a person would actually weigh or count", () => {
    expect(roundUsual(183.5, "g")).toBe(185);
    expect(roundUsual(32.4, "ml")).toBe(32);
    expect(roundUsual(1.3, "serving")).toBe(1.5);
    expect(roundUsual(0.1, "serving")).toBe(0.5);
  });
});
