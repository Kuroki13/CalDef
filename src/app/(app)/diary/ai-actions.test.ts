import { beforeEach, describe, expect, it, vi } from "vitest";
import { restaurantById } from "@/lib/food/restaurant-catalogue";

const cacheFood = vi.fn();
const prepareCachedFoodLog = vi.fn();
const writeLogsOnce = vi.fn();
const getUserId = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUserId: () => getUserId() }));
vi.mock("@/lib/food/cache", () => ({ cacheFood: (...args: unknown[]) => cacheFood(...args) }));
vi.mock("@/lib/food-log", () => ({
  prepareCachedFoodLog: (...args: unknown[]) => prepareCachedFoodLog(...args),
  writeLogsOnce: (...args: unknown[]) => writeLogsOnce(...args),
  updateEntryPortion: vi.fn(),
}));
const { saveParsedFoods, logParsedFoods } = await import("./ai-actions");
const food = restaurantById("restaurant:harveys:big-harv-angus")!;
const KEY = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
function form(items = [{ food, amount: 1, unit: "serving", servingLabel: food.servings[0].label }]) {
  const data = new FormData();
  data.set("payload", JSON.stringify({ items, logDate: "2026-09-06", mealTypeId: 2 }));
  data.set("clientToken", KEY);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user-a");
  cacheFood.mockResolvedValue(42);
  prepareCachedFoodLog.mockImplementation(async (i: { foodId: number }) => ({ row: { food_id: i.foodId } }));
  writeLogsOnce.mockImplementation(async (r: unknown[]) => ({ ids: r.map((_, i) => i + 1), replayed: false }));
});
describe("confirmed assistant food actions", () => {
  it("saves a food without writing a diary entry", async () => {
    const state = await saveParsedFoods({}, form());
    expect(state.ok).toBe(true);
    expect(state.notice).toContain("Nothing was added to your diary");
    expect(cacheFood).toHaveBeenCalledOnce();
    expect(writeLogsOnce).not.toHaveBeenCalled();
  });
  it("logs through the authoritative cached-food path with the chosen meal and date", async () => {
    expect((await logParsedFoods({}, form())).ok).toBe(true);
    expect(prepareCachedFoodLog).toHaveBeenCalledWith({ foodId: 42, amount: 1, unit: "serving", servingLabel: food.servings[0].label, logDate: "2026-09-06", mealTypeId: 2, source: "ai" });
    expect(writeLogsOnce).toHaveBeenCalledWith([{ food_id: 42 }], KEY);
  });
  it("requires authentication even if the food already exists in the shared cache", async () => {
    getUserId.mockResolvedValue(null);
    expect((await saveParsedFoods({}, form())).error).toContain("sign in");
    expect((await logParsedFoods({}, form())).error).toContain("sign in");
    expect(cacheFood).not.toHaveBeenCalled();
  });
  it("writes a reviewed meal of several foods once, in one operation, under the form's key", async () => {
    cacheFood.mockResolvedValueOnce(42).mockResolvedValueOnce(43);
    const item = { food, amount: 1, unit: "serving", servingLabel: food.servings[0].label };
    expect(await logParsedFoods({}, form([item, item]))).toEqual({ ok: true, notice: "Added 2 items." });
    expect(writeLogsOnce).toHaveBeenCalledTimes(1);
    expect(writeLogsOnce).toHaveBeenCalledWith([{ food_id: 42 }, { food_id: 43 }], KEY);
  });
  it("writes nothing when one food cannot be logged, and names it", async () => {
    cacheFood.mockResolvedValueOnce(42).mockRejectedValueOnce(new Error("database down"));
    const item = { food, amount: 1, unit: "serving", servingLabel: food.servings[0].label };
    const state = await logParsedFoods({}, form([item, item]));
    expect(writeLogsOnce).not.toHaveBeenCalled();
    expect(state.ok).toBeUndefined();
    expect(state.error).toContain(`Nothing was added — could not add ${food.name}`);
  });
  it("passes on a refused replay instead of claiming success", async () => {
    writeLogsOnce.mockResolvedValue({ error: "already added with different details" });
    expect(await logParsedFoods({}, form())).toEqual({ error: "already added with different details" });
  });
  it("rejects malformed payloads before saving", async () => {
    expect((await saveParsedFoods({}, new FormData())).error).toBeTruthy();
    expect(cacheFood).not.toHaveBeenCalled();
  });
});
