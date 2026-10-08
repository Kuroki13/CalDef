import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/recipes/library-forms", () => ({
  LogRecipeForm: ({ recipeId }: { recipeId: number }) => <p>log recipe {recipeId}</p>,
  LogSavedMealForm: ({ savedMealId }: { savedMealId: number }) => <p>log meal {savedMealId}</p>,
}));

const { MyFoods, availableViews, matchesFilter } = await import("@/components/my-foods");
import { EMPTY_LIBRARY, type PersonalLibrary } from "@/lib/food/library-types";
import type { CachedFood } from "@/lib/food/types";

const food = (id: number, name: string, over: Partial<CachedFood> = {}): CachedFood => ({
  id,
  sourceId: String(id),
  source: "usda",
  name,
  brand: null,
  description: null,
  barcode: null,
  isVerified: true,
  nutrients: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  servings: [],
  dataUpdatedAt: null,
  ...over,
});

const chicken = food(1, "Chicken breast, grilled");
const yogurt = food(2, "Protein yogurt", { source: "custom", brand: "Président" });

const library: PersonalLibrary = {
  ...EMPTY_LIBRARY,
  recent: [yogurt, chicken],
  frequent: [chicken],
  custom: [yogurt],
  recipes: [
    { id: 7, name: "Mom's maqlouba", servings: 6, kcalPerServing: 540, hasIngredients: true, isFamily: true, cookedWeightG: 2400 },
    { id: 8, name: "Empty idea", servings: 1, kcalPerServing: 0, hasIngredients: false, isFamily: false, cookedWeightG: null },
  ],
};

const renderLibrary = (lib = library, onChoose = vi.fn()) => {
  render(<MyFoods library={lib} logDate="2026-10-07" mealTypes={[]} onChoose={onChoose} />);
  return onChoose;
};

const familyLibrary: PersonalLibrary = {
  ...EMPTY_LIBRARY,
  family: [
    {
      kind: "recipe",
      id: "recipe:7",
      name: "Mom's maqlouba",
      recipe: { id: 7, name: "Mom's maqlouba", servings: 6, kcalPerServing: 540, hasIngredients: true, isFamily: true, cookedWeightG: 2400 },
    },
    { kind: "food", id: "food:2", name: yogurt.name, brand: yogurt.brand, food: { ...yogurt, isFamily: true } },
  ],
};

describe("MyFoods — Family (§13H)", () => {
  it("gathers marked recipes and foods under one filter", () => {
    const onChoose = vi.fn();
    render(<MyFoods library={familyLibrary} logDate="2026-10-08" mealTypes={[]} onChoose={onChoose} />);
    expect(screen.getByRole("button", { name: "Family" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Mom's maqlouba")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Protein yogurt/ }));
    expect(onChoose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Log Mom's maqlouba" }));
    expect(screen.getByText("log recipe 7")).toBeInTheDocument();
  });
});

describe("availableViews", () => {
  it("offers only the filters that have something in them, in a fixed order", () => {
    expect(availableViews(library)).toEqual(["recent", "frequent", "custom", "recipes"]);
    expect(availableViews(EMPTY_LIBRARY)).toEqual([]);
  });
});

describe("matchesFilter", () => {
  it("needs every word, in any order, accents ignored, brand included", () => {
    expect(matchesFilter(chicken, "grilled chicken")).toBe(true);
    expect(matchesFilter(chicken, "chicken thigh")).toBe(false);
    expect(matchesFilter(yogurt, "president")).toBe(true);
    expect(matchesFilter(yogurt, "")).toBe(true);
  });
});

describe("MyFoods", () => {
  it("opens on recent and hands a chosen food to the normal portion step", () => {
    const onChoose = renderLibrary();
    expect(screen.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Protein yogurt/ }));
    expect(onChoose).toHaveBeenCalledWith(yogurt);
  });

  it("does not show a filter with nothing in it", () => {
    renderLibrary();
    expect(screen.queryByRole("button", { name: "Scanned" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Meals" })).not.toBeInTheDocument();
  });

  it("narrows the list as you type, and says so when nothing is left", () => {
    renderLibrary();
    fireEvent.change(screen.getByLabelText("Filter my foods"), { target: { value: "chicken" } });
    expect(screen.queryByRole("button", { name: /Protein yogurt/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Chicken breast/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter my foods"), { target: { value: "pizza" } });
    expect(screen.getByText(/Search looks further/)).toBeInTheDocument();
  });

  it("logs a recipe through the Recipes screen's own form, and offers no button for an empty one", () => {
    renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Recipes" }));
    expect(screen.queryByRole("button", { name: "Log Empty idea" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log Mom's maqlouba" }));
    expect(screen.getByText("log recipe 7")).toBeInTheDocument();
  });

  it("explains itself to someone with nothing yet", () => {
    renderLibrary(EMPTY_LIBRARY);
    expect(screen.getByText(/one tap away instead of a search/)).toBeInTheDocument();
  });
});
