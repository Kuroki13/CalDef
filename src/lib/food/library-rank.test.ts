import { describe, expect, it } from "vitest";

import {
  FREQUENT_MIN_COUNT,
  frequentFoodIds,
  recentFoodIds,
  scannedFoodIds,
  summariseUse,
  type LogSignal,
} from "@/lib/food/library-rank";

const log = (foodId: number, day: number, source = "manual"): LogSignal => ({
  foodId,
  source,
  loggedAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`,
});

describe("summariseUse", () => {
  it("counts each food and keeps its latest use, in whatever order rows arrive", () => {
    const uses = summariseUse([log(1, 3), log(1, 7), log(2, 5), log(1, 1)]);
    expect(uses.get(1)).toMatchObject({ count: 3, lastLoggedAt: log(1, 7).loggedAt });
    expect(uses.get(2)).toMatchObject({ count: 1 });
  });

  it("remembers a food was scanned even if later logged by hand", () => {
    const uses = summariseUse([log(1, 1, "barcode"), log(1, 2)]);
    expect(uses.get(1)?.scanned).toBe(true);
  });
});

describe("the library's lists", () => {
  // Chicken (1) daily for a week; yogurt (2) twice; an odd bar (3) once,
  // most recently of all; a scanned drink (4) once.
  const uses = summariseUse([
    ...[1, 2, 3, 4, 5, 6, 7].map((d) => log(1, d)),
    log(2, 2),
    log(2, 6),
    log(3, 8),
    log(4, 4, "barcode"),
  ]);

  it("puts the most recent first", () => {
    expect(recentFoodIds(uses)).toEqual([3, 1, 2, 4]);
  });

  it("ranks frequent by count and leaves out a one-off", () => {
    expect(frequentFoodIds(uses)).toEqual([1, 2]);
    expect(FREQUENT_MIN_COUNT).toBe(2);
  });

  it("breaks a frequency tie by recency", () => {
    const tied = summariseUse([log(5, 1), log(5, 2), log(6, 3), log(6, 4)]);
    expect(frequentFoodIds(tied)).toEqual([6, 5]);
  });

  it("lists scanned foods", () => {
    expect(scannedFoodIds(uses)).toEqual([4]);
  });

  it("is capped, because a library is not an archive", () => {
    const many = summariseUse(Array.from({ length: 30 }, (_, i) => log(100 + i, 1 + (i % 28))));
    expect(recentFoodIds(many)).toHaveLength(12);
    expect(recentFoodIds(many, 3)).toHaveLength(3);
  });

  it("is empty for someone who has logged nothing", () => {
    const none = summariseUse([]);
    expect(recentFoodIds(none)).toEqual([]);
    expect(frequentFoodIds(none)).toEqual([]);
  });
});
