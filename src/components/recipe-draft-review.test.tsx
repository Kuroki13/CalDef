import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FoodProposal } from "@/lib/ai/resolve";
import type { Food } from "@/lib/food/types";

const saveDraftedRecipe = vi.fn();
vi.mock("@/app/(app)/recipes/draft-actions", () => ({
  saveDraftedRecipe: (...a: unknown[]) => saveDraftedRecipe(...a),
}));

const { RecipeDraftReview } = await import("@/components/recipe-draft-review");

const food = (name: string, kcal: number, protein: number): Food => ({
  sourceId: name,
  source: "usda",
  name,
  brand: null,
  description: null,
  barcode: null,
  isVerified: true,
  nutrients: { kcal, protein_g: protein, carbs_g: 0, fat_g: 0 },
  servings: [{ label: "100 g", grams: 100, isDefault: true }],
  dataUpdatedAt: null,
});

const proposal = (
  query: string,
  amount: number,
  match: Food | null,
): FoodProposal => ({
  intent: { query, amount, unit: "g" },
  match,
  alternatives: [],
  grams: match ? amount : null,
  macros: null,
});

/** The payload the form would post, which is what the server acts on. */
function payload(): Record<string, unknown> {
  const field = document.querySelector<HTMLInputElement>(
    'input[name="payload"]',
  );
  return JSON.parse(field?.value ?? "{}");
}

beforeEach(() => vi.clearAllMocks());

describe("RecipeDraftReview — the total is the sum of its parts", () => {
  it("adds up the resolved ingredients and divides by the servings", async () => {
    // 800 g of a 200 kcal/100 g food is 1600 kcal; 500 g of a 100 kcal/100 g
    // food is 500. The whole dish is 2100, and at four servings that is 525.
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[
          proposal("chicken thigh", 800, food("Chicken thigh", 200, 20)),
          proposal("basmati rice", 500, food("Rice", 100, 3)),
        ]}
      />,
    );

    expect(screen.getByText(/Whole recipe: 2100 kcal/)).toBeInTheDocument();
    expect(screen.getByText(/Per serving: 525 kcal/)).toBeInTheDocument();
    // Protein: 160 g + 15 g.
    expect(screen.getByText(/Whole recipe:.*Protein 175\.0 g/)).toBeInTheDocument();
  });

  it("follows the arithmetic when an amount is corrected", async () => {
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[proposal("chicken thigh", 800, food("Chicken thigh", 200, 20))]}
      />,
    );

    expect(screen.getByText(/Whole recipe: 1600 kcal/)).toBeInTheDocument();

    // The owner weighed it: 600 g, not 800.
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "600" },
    });

    expect(screen.getByText(/Whole recipe: 1200 kcal/)).toBeInTheDocument();
  });

  it("drops an excluded ingredient out of the total", async () => {
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[
          proposal("chicken thigh", 800, food("Chicken thigh", 200, 20)),
          proposal("basmati rice", 500, food("Rice", 100, 3)),
        ]}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("checkbox", { name: /include this ingredient/i })[1],
    );

    expect(screen.getByText(/Whole recipe: 1600 kcal/)).toBeInTheDocument();
    expect(payload().ingredients).toHaveLength(1);
  });

  it("recomputes per-serving when the serving count changes", async () => {
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[proposal("chicken thigh", 800, food("Chicken thigh", 200, 20))]}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Servings it makes/), {
      target: { value: "8" },
    });

    expect(screen.getByText(/Per serving: 200 kcal/)).toBeInTheDocument();
    expect(payload().servings).toBe(8);
  });
});

describe("RecipeDraftReview — an unresolved ingredient", () => {
  const withUnresolved = () =>
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[
          proposal("chicken thigh", 800, food("Chicken thigh", 200, 20)),
          proposal("maqlouba spice mix", 20, null),
        ]}
      />,
    );

  it("is shown as unmatched rather than quietly left out", () => {
    withUnresolved();

    expect(
      screen.getByText(/No food matched “maqlouba spice mix”/),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be matched/);
  });

  it("blocks saving until it is replaced or removed", () => {
    withUnresolved();

    // The point: a recipe with a guessed ingredient in it would produce a
    // calorie figure with no food behind part of it.
    expect(screen.getByRole("button", { name: /save recipe/i })).toBeDisabled();
  });

  it("never reaches the payload as a guess", () => {
    withUnresolved();

    const items = payload().ingredients as unknown[];
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain("maqlouba spice mix");
  });

  it("can be removed, after which the recipe saves", () => {
    withUnresolved();

    fireEvent.click(
      screen.getAllByRole("button", { name: /remove this ingredient/i })[1],
    );

    expect(
      screen.queryByText(/No food matched/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save recipe/i })).toBeEnabled();
  });
});

describe("RecipeDraftReview — what it says about itself", () => {
  it("names which half was estimated and which was computed", () => {
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[proposal("chicken thigh", 800, food("Chicken thigh", 200, 20))]}
      />,
    );

    expect(screen.getByText(/estimated by the assistant/i)).toBeInTheDocument();
    expect(
      screen.getByText(/computed from the matched food/i),
    ).toBeInTheDocument();
  });

  it("marks the recipe as AI-drafted in what it sends", () => {
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[proposal("chicken thigh", 800, food("Chicken thigh", 200, 20))]}
      />,
    );

    expect(payload().aiDrafted).toBe(true);
    expect(payload().name).toBe("chicken maqlouba");
  });

  it("sends foods and amounts, never a computed figure", () => {
    // The server recomputes every macro from the stored nutrient rows, so a
    // total in this payload could only ever be ignored — or trusted, which
    // is the failure this shape prevents.
    render(
      <RecipeDraftReview
        dish="chicken maqlouba"
        degraded={false}
        proposals={[proposal("chicken thigh", 800, food("Chicken thigh", 200, 20))]}
      />,
    );

    const sent = payload();
    expect(Object.keys(sent).sort()).toEqual([
      "aiDrafted",
      "ingredients",
      "name",
      "servings",
    ]);
    const [ingredient] = sent.ingredients as Record<string, unknown>[];
    expect(Object.keys(ingredient).sort()).toEqual([
      "amount",
      "food",
      "servingLabel",
      "unit",
    ]);
  });
});
