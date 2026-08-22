import { describe, expect, it } from "vitest";

import {
  ACTIVITY_MULTIPLIERS,
  ageFromBirthDate,
  bmr,
  formulaTdee,
} from "@/lib/tdee/bmr";

describe("bmr — Mifflin-St Jeor", () => {
  it("computes the male equation", () => {
    // 10(80) + 6.25(180) - 5(30) + 5 = 1780
    expect(bmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male" })).toBe(
      1780,
    );
  });

  it("computes the female equation", () => {
    // 10(65) + 6.25(165) - 5(30) - 161 = 1370.25, rounded to one decimal.
    expect(bmr({ weightKg: 65, heightCm: 165, age: 30, sex: "female" })).toBe(
      1370.3,
    );
  });

  it("puts 'other' between the two rather than defaulting to either", () => {
    const shared = { weightKg: 80, heightCm: 180, age: 30 } as const;
    const male = bmr({ ...shared, sex: "male" });
    const female = bmr({ ...shared, sex: "female" });
    const other = bmr({ ...shared, sex: "other" });

    expect(other).toBeLessThan(male);
    expect(other).toBeGreaterThan(female);
    expect(other).toBeCloseTo((male + female) / 2, 1);
  });

  it("rises with weight and falls with age", () => {
    const base = { heightCm: 180, age: 30, sex: "male" } as const;
    expect(bmr({ ...base, weightKg: 90 })).toBeGreaterThan(
      bmr({ ...base, weightKg: 80 }),
    );
    expect(bmr({ ...base, weightKg: 80, age: 50 })).toBeLessThan(
      bmr({ ...base, weightKg: 80 }),
    );
  });

  it("rejects impossible inputs", () => {
    expect(() =>
      bmr({ weightKg: 0, heightCm: 180, age: 30, sex: "male" }),
    ).toThrow();
    expect(() =>
      bmr({ weightKg: 80, heightCm: 0, age: 30, sex: "male" }),
    ).toThrow();
  });
});

describe("formulaTdee", () => {
  const subject = {
    weightKg: 111.8,
    heightCm: 185,
    age: 30,
    sex: "male",
  } as const;

  it("scales the resting rate by the activity multiplier", () => {
    const resting = bmr(subject);
    expect(formulaTdee(subject, "moderate")).toBeCloseTo(
      resting * ACTIVITY_MULTIPLIERS.moderate,
      1,
    );
  });

  it("orders the activity levels", () => {
    const levels = [
      "sedentary",
      "light",
      "moderate",
      "very",
      "extra",
    ] as const;
    const values = levels.map((l) => formulaTdee(subject, l));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it("lands in the spec's ballpark for the starting profile", () => {
    // The spec's ~3357 kcal seed (§6) is illustrative of one profile rather
    // than a formula output to reproduce exactly, so this asserts the range
    // a 111.8 kg moderately active adult should fall in.
    const value = formulaTdee(subject, "moderate");
    expect(value).toBeGreaterThan(3000);
    expect(value).toBeLessThan(3600);
  });
});

describe("ageFromBirthDate", () => {
  it("counts whole years", () => {
    expect(ageFromBirthDate("1995-08-22", "2026-08-22")).toBe(31);
  });

  it("does not count a birthday that has not arrived", () => {
    expect(ageFromBirthDate("1995-08-23", "2026-08-22")).toBe(30);
    expect(ageFromBirthDate("1995-12-01", "2026-08-22")).toBe(30);
  });
});
