import { beforeEach, describe, expect, it, vi } from "vitest";
import { restaurantById } from "./restaurant-catalogue";

const requireUserId = vi.fn();
const createCustomFood = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireUserId: () => requireUserId(),
  createClient: async () => ({ from: () => ({ select: () => ({ eq }) }) }),
}));
vi.mock("@/lib/food/custom", () => ({ createCustomFood: (...args: unknown[]) => createCustomFood(...args) }));
const { importRestaurantFood } = await import("./restaurant-import");
const { cacheFood } = await import("./cache");
const food = restaurantById("restaurant:harveys:big-harv-angus")!;

beforeEach(() => {
  vi.clearAllMocks();
  requireUserId.mockResolvedValue("user-a");
  eq.mockReturnValue({ eq, maybeSingle });
  maybeSingle.mockResolvedValue({ data: null, error: null });
  createCustomFood.mockResolvedValue({ food: { ...food, id: 42 } });
});

describe("private restaurant import", () => {
  it("ignores forged browser nutrition and imports only the server reference", async () => {
    const id = await cacheFood({ ...food, name: "fake", nutrients: { kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 } });
    expect(id).toBe(42);
    expect(createCustomFood).toHaveBeenCalledWith(expect.objectContaining({ name: "Big Harv (Angus)", kcal: food.nutrients.kcal, servingGrams: 281 }), { sourceId: `${food.sourceId}:user-a`, description: food.description });
    expect(eq).toHaveBeenCalledWith("user_id", "user-a");
  });
  it("reuses the same owner's imported row without duplicate writes", async () => {
    maybeSingle.mockResolvedValue({ data: { id: 42, archived_at: null, description: food.description }, error: null });
    expect(await importRestaurantFood(food.sourceId)).toBe(42);
    expect(createCustomFood).not.toHaveBeenCalled();
  });
  it("does not silently log edited data under the official preview", async () => {
    maybeSingle.mockResolvedValue({ data: { id: 42, archived_at: null, description: null }, error: null });
    await expect(importRestaurantFood(food.sourceId)).rejects.toThrow("edited");
  });
  it("does not restore an archived food or import an unknown reference", async () => {
    maybeSingle.mockResolvedValue({ data: { id: 42, archived_at: "2026-09-06" }, error: null });
    await expect(importRestaurantFood(food.sourceId)).rejects.toThrow("removed");
    await expect(importRestaurantFood("restaurant:unknown:burger")).rejects.toThrow("unavailable");
    expect(createCustomFood).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated imports", async () => {
    requireUserId.mockRejectedValue(new Error("Not authenticated"));
    await expect(importRestaurantFood(food.sourceId)).rejects.toThrow("authenticated");
    expect(createCustomFood).not.toHaveBeenCalled();
  });
});
