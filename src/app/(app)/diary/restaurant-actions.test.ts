import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheFood = vi.fn();
const logCachedFood = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/food/cache", () => ({ cacheFood: (f: unknown) => cacheFood(f) }));
vi.mock("@/lib/food-log", () => ({ logCachedFood: (i: unknown) => logCachedFood(i) }));

const { logRestaurantPartsAction } = await import("@/app/(app)/diary/restaurant-actions");

const form = (pairs: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of [["chain", "fiveguys"], ["logDate", "2026-10-08"], ["mealTypeId", "3"], ...pairs]) f.append(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  cacheFood.mockResolvedValue(41);
  logCachedFood.mockResolvedValue({ ok: true });
});

describe("logRestaurantPartsAction", () => {
  it("logs each official part through the normal path, by count of its published portion", async () => {
    const result = await logRestaurantPartsAction({}, form([["part:patty", "2"], ["part:bun", "1"]]));
    expect(result).toMatchObject({ ok: true });
    expect(cacheFood).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "restaurant:fiveguys:patty", brand: "Five Guys" }));
    expect(logCachedFood).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2, unit: "serving", servingLabel: "1 portion (65 g)" }),
    );
  });

  it("refuses a part that is not on the official sheet", async () => {
    expect(await logRestaurantPartsAction({}, form([["part:double-double", "1"]]))).toEqual({
      error: "One of those parts is not on the official sheet.",
    });
    expect(logCachedFood).not.toHaveBeenCalled();
  });

  it("refuses nothing chosen, and silly counts", async () => {
    expect((await logRestaurantPartsAction({}, form([]))).error).toMatch(/at least one/);
    expect((await logRestaurantPartsAction({}, form([["part:bun", "1.5"]]))).error).toMatch(/whole number/);
  });
});
