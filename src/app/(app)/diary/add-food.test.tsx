import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Everything that would reach a server, or a camera, is out of scope here.
vi.mock("@/app/(app)/diary/actions", () => ({ logFood: vi.fn(async () => ({})) }));
vi.mock("@/app/(app)/recipes/library-forms", () => ({
  LogRecipeForm: () => null,
  LogSavedMealForm: () => null,
}));
vi.mock("@/components/barcode-scanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/components/describe-dish", () => ({ DescribeDish: () => null }));
vi.mock("@/components/describe-meal", () => ({ DescribeMeal: () => null }));
vi.mock("@/components/custom-food-form", () => ({ CustomFoodForm: () => null }));

const { AddFood } = await import("@/app/(app)/diary/add-food");
import { EMPTY_LIBRARY, type PersonalLibrary } from "@/lib/food/library-types";
import type { CachedFood } from "@/lib/food/types";

const chicken: CachedFood = {
  id: 7,
  sourceId: "171477",
  source: "usda",
  name: "Chicken breast, grilled",
  brand: null,
  description: null,
  barcode: null,
  isVerified: true,
  nutrients: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  servings: [],
  dataUpdatedAt: null,
};

const library: PersonalLibrary = {
  ...EMPTY_LIBRARY,
  recent: [chicken],
  usual: { 7: { amount: 185, unit: "g", servingLabel: null, basedOn: 4 } },
};

const meals = [{ id: 1, slug: "breakfast", name: "Breakfast", sort_order: 1 }];

describe("AddFood — your usual portion (§12D)", () => {
  it("offers the usual amount without applying it, and applies it on a tap", () => {
    render(<AddFood logDate="2026-10-07" mealTypes={meals} library={library} />);
    fireEvent.click(screen.getByRole("button", { name: /Chicken breast, grilled/ }));

    expect(screen.getByText(/Your usual: about/)).toHaveTextContent("185 g");
    // A suggestion, not a change: the amount is still the default.
    expect(screen.getByLabelText("Amount")).toHaveValue(100);

    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(screen.getByLabelText("Amount")).toHaveValue(185);
    expect(screen.queryByRole("button", { name: "Use this" })).not.toBeInTheDocument();
  });

  it("says nothing for a food without a habit", () => {
    render(
      <AddFood
        logDate="2026-10-07"
        mealTypes={meals}
        library={{ ...library, usual: {} }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Chicken breast, grilled/ }));
    expect(screen.queryByText(/Your usual/)).not.toBeInTheDocument();
  });

  it("does not offer a serving the food no longer has", () => {
    render(
      <AddFood
        logDate="2026-10-07"
        mealTypes={meals}
        library={{
          ...library,
          usual: { 7: { amount: 1, unit: "serving", servingLabel: "1 fillet", basedOn: 5 } },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Chicken breast, grilled/ }));
    expect(screen.queryByText(/Your usual/)).not.toBeInTheDocument();
  });
});
