import { describe, expect, it } from "vitest";

import { mealForHour } from "@/lib/meal-suggestion";

const meals = [
  { id: 1, slug: "breakfast" },
  { id: 2, slug: "lunch" },
  { id: 3, slug: "dinner" },
  { id: 4, slug: "snack" },
];

describe("mealForHour", () => {
  it("follows the day", () => {
    expect(mealForHour(meals, 8)?.slug).toBe("breakfast");
    expect(mealForHour(meals, 12)?.slug).toBe("lunch");
    expect(mealForHour(meals, 16)?.slug).toBe("snack");
    expect(mealForHour(meals, 20)?.slug).toBe("dinner");
    expect(mealForHour(meals, 1)?.slug).toBe("snack");
  });

  it("does not pick an empty meal just because it is empty: dinner at 8 pm is dinner", () => {
    // The old rule chose the first meal with nothing in it, so breakfast at
    // eight in the evening was the default if breakfast was skipped.
    expect(mealForHour(meals, 20)?.id).toBe(3);
  });

  it("falls back to the first meal when the expected one does not exist", () => {
    expect(mealForHour([{ id: 9, slug: null }], 12)?.id).toBe(9);
  });
});
