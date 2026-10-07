import { describe, expect, it } from "vitest";

import { amountUnit, formatAmount, per100Label } from "@/lib/food/basis";

describe("food amount wording", () => {
  it("reads a food with no basis as weighed — every provider food is", () => {
    expect(amountUnit({})).toBe("g");
    expect(per100Label({})).toBe("100 g");
  });

  it("reads a drink in millilitres", () => {
    expect(per100Label({ basisUnit: "ml" })).toBe("100 ml");
    expect(formatAmount({ basisUnit: "ml" }, 330)).toBe("330 ml");
  });

  it("trims a stored decimal to something readable", () => {
    expect(formatAmount({ basisUnit: "g" }, 42.456)).toBe("42.5 g");
  });
});
