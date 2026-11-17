import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheFood = vi.fn();
const prepareCachedFoodLog = vi.fn();
const writeLogsOnce = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/food/cache", () => ({ cacheFood: (f: unknown) => cacheFood(f) }));
vi.mock("@/lib/food-log", () => ({
  prepareCachedFoodLog: (i: unknown) => prepareCachedFoodLog(i),
  writeLogsOnce: (r: unknown, k: unknown) => writeLogsOnce(r, k),
}));
const KEY = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const { logRestaurantPartsAction } = await import("@/app/(app)/diary/restaurant-actions");

const form = (pairs: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of [["chain", "fiveguys"], ["logDate", "2026-10-08"], ["mealTypeId", "3"], ["clientToken", KEY], ...pairs]) f.append(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  cacheFood.mockResolvedValue(41);
  prepareCachedFoodLog.mockImplementation(async (i: { amount: number }) => ({ row: { amount: i.amount } }));
  writeLogsOnce.mockImplementation(async (r: unknown[]) => ({ ids: r.map((_, i) => i + 1), replayed: false }));
});

describe("logRestaurantPartsAction", () => {
  it("logs each official part through the normal path, by count of its published portion", async () => {
    const result = await logRestaurantPartsAction({}, form([["part:patty", "2"], ["part:bun", "1"]]));
    expect(result).toMatchObject({ ok: true });
    expect(cacheFood).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "restaurant:fiveguys:patty", brand: "Five Guys" }));
    expect(prepareCachedFoodLog).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2, unit: "serving", servingLabel: "1 portion (65 g)" }),
    );
    // The whole order is one write, under the form's key.
    expect(writeLogsOnce).toHaveBeenCalledTimes(1);
    expect(writeLogsOnce).toHaveBeenCalledWith([{ amount: 2 }, { amount: 1 }], KEY);
  });

  it("refuses a part that is not on the official sheet", async () => {
    expect(await logRestaurantPartsAction({}, form([["part:double-double", "1"]]))).toEqual({
      error: "One of those parts is not on the official sheet.",
    });
    expect(writeLogsOnce).not.toHaveBeenCalled();
  });

  it("refuses nothing chosen, and silly counts", async () => {
    expect((await logRestaurantPartsAction({}, form([]))).error).toMatch(/at least one/);
    expect((await logRestaurantPartsAction({}, form([["part:bun", "1.5"]]))).error).toMatch(/whole number/);
  });
});
