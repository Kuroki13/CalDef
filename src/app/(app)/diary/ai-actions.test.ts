import { beforeEach, describe, expect, it, vi } from "vitest";
import { restaurantById } from "@/lib/food/restaurant-catalogue";

const cacheFood = vi.fn();
const logCachedFood = vi.fn();
const getUserId = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUserId: () => getUserId() }));
vi.mock("@/lib/food/cache", () => ({ cacheFood: (...args: unknown[]) => cacheFood(...args) }));
vi.mock("@/lib/food-log", () => ({ logCachedFood: (...args: unknown[]) => logCachedFood(...args), updateEntryPortion: vi.fn() }));
const { saveParsedFoods, logParsedFoods } = await import("./ai-actions");
const food = restaurantById("restaurant:harveys:big-harv-angus")!;
function form(items = [{ food, amount: 1, unit: "serving", servingLabel: food.servings[0].label }]) {
  const data = new FormData();
  data.set("payload", JSON.stringify({ items, logDate: "2026-09-06", mealTypeId: 2 }));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user-a");
  cacheFood.mockResolvedValue(42);
  logCachedFood.mockResolvedValue({ ok: true });
});
describe("confirmed assistant food actions", () => {
  it("saves a food without writing a diary entry", async () => {
    const state = await saveParsedFoods({}, form());
    expect(state.ok).toBe(true);
    expect(state.notice).toContain("Nothing was added to your diary");
    expect(cacheFood).toHaveBeenCalledOnce();
    expect(logCachedFood).not.toHaveBeenCalled();
  });
  it("logs through the authoritative cached-food path with the chosen meal and date", async () => {
    expect((await logParsedFoods({}, form())).ok).toBe(true);
    expect(logCachedFood).toHaveBeenCalledWith({ foodId: 42, amount: 1, unit: "serving", servingLabel: food.servings[0].label, logDate: "2026-09-06", mealTypeId: 2, source: "ai" });
  });
  it("requires authentication even if the food already exists in the shared cache", async () => {
    getUserId.mockResolvedValue(null);
    expect((await saveParsedFoods({}, form())).error).toContain("sign in");
    expect((await logParsedFoods({}, form())).error).toContain("sign in");
    expect(cacheFood).not.toHaveBeenCalled();
  });
  it("reports a partial write accurately so the review cannot be submitted twice", async () => {
    cacheFood.mockResolvedValueOnce(42).mockRejectedValueOnce(new Error("database down"));
    const item = { food, amount: 1, unit: "serving", servingLabel: food.servings[0].label };
    const state = await logParsedFoods({}, form([item, item]));
    expect(state.ok).toBe(true);
    expect(state.notice).toContain("Added 1. Could not add");
    expect(logCachedFood).toHaveBeenCalledOnce();
  });
  it("rejects malformed payloads before saving", async () => {
    expect((await saveParsedFoods({}, new FormData())).error).toBeTruthy();
    expect(cacheFood).not.toHaveBeenCalled();
  });
});
