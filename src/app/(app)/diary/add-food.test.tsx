import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { describe, expect, it, vi } from "vitest";

// Everything that would reach a server, or a camera, is out of scope here.
vi.mock("@/app/(app)/diary/actions", () => ({ logFood: vi.fn(async () => ({})) }));
vi.mock("@/app/(app)/recipes/library-forms", () => ({
  LogRecipeForm: () => null,
  LogSavedMealForm: () => null,
}));
vi.mock("@/components/barcode-scanner", () => ({ BarcodeScanner: () => null }));
vi.mock("@/components/describe-dish", () => ({
  DescribeDish: ({ initialDish }: { initialDish: string }) => <p>describe-dish: {initialDish}</p>,
}));
vi.mock("@/components/describe-meal", () => ({
  DescribeMeal: ({ initialText }: { initialText?: string }) => (
    <p>describe-meal: {initialText}</p>
  ),
}));
vi.mock("@/components/custom-food-form", () => ({ CustomFoodForm: () => null }));
vi.mock("@/components/quick-add-form", () => ({ QuickAddForm: () => null }));

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

describe("AddFood — when search finds nothing", () => {
  afterEach(() => vi.unstubAllGlobals());

  const searchFor = async (text: string, aiReady = true) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ foods: [] }), { status: 200 })),
    );
    render(<AddFood logDate="2026-10-07" mealTypes={meals} aiReady={aiReady} />);
    fireEvent.change(screen.getByLabelText("Search foods"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText(/No match for/, {}, { timeout: 5000 });
  };

  it("asks one question with plainly named answers, even for a single word", async () => {
    await searchFor("Maqlouba");
    expect(screen.getByText(/How do you want to add it/)).toBeInTheDocument();
    for (const name of [
      /Describe what you ate/,
      /Build it from ingredients/,
      /Add it from the packet/,
      /Just the calories/,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // Nothing opens by itself, and the links below would only repeat two
    // of the answers.
    expect(screen.queryByText(/describe-dish/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add your own food" })).not.toBeInTheDocument();
  });

  it("hands what was typed to Describe a meal", async () => {
    await searchFor("Maqlouba");
    fireEvent.click(screen.getByRole("button", { name: /Describe what you ate/ }));
    expect(await screen.findByText("describe-meal: Maqlouba")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Describe a meal" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the recipe draft only when asked, starting from what was typed", async () => {
    await searchFor("Maqlouba");
    fireEvent.click(screen.getByRole("button", { name: /Build it from ingredients/ }));
    expect(screen.getByText("describe-dish: Maqlouba")).toBeInTheDocument();
  });

  it("offers only the two paths that need no assistant when it is off", async () => {
    await searchFor("Maqlouba", false);
    expect(screen.queryByRole("button", { name: /Describe what you ate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Build it from ingredients/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add it from the packet/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Just the calories/ })).toBeInTheDocument();
  });
});

describe("AddFood — a recognised dish (§13A–§13E)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const warakEnab = {
    id: "warak-enab",
    name: "Stuffed grape leaves (warak enab)",
    arabic: "ورق عنب",
    about: "Grape leaves rolled around rice — with meat, or meatless in oil.",
    variant: null,
    variants: [
      { id: "meat", label: "With meat and rice", searchAs: "stuffed grape leaves with meat" },
      { id: "vegetarian", label: "Rice only, in oil (yalanji)", searchAs: "stuffed grape leaves rice" },
    ],
    variantOpen: true,
    searchAs: "stuffed grape leaves",
  };

  it("says what it understood, asks which kind first, and searches again with the answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ foods: [], recognised: warakEnab, strongMatch: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            foods: [],
            recognised: { ...warakEnab, variant: { id: "meat", label: "With meat and rice" }, variantOpen: false },
            strongMatch: false,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AddFood logDate="2026-10-07" mealTypes={meals} aiReady />);
    fireEvent.change(screen.getByLabelText("Search foods"), { target: { value: "warak 3enab" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("ورق عنب", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Which kind?")).toBeInTheDocument();
    // One question at a time: the four ways in wait for this answer.
    expect(screen.queryByText(/How do you want to add it/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "With meat and rice" }));
    await screen.findByText(/How do you want to add it/, {}, { timeout: 5000 });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      encodeURIComponent("stuffed grape leaves with meat"),
    );
    expect(screen.queryByText("Which kind?")).not.toBeInTheDocument();
  });

  it("trusts the server when a differently spelled food answers the query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            foods: [{ ...chicken, id: 9, source: "custom", name: "Mom's Maqlouba" }],
            recognised: { ...warakEnab, id: "maqluba", variantOpen: false, variants: [] },
            strongMatch: true,
          }),
          { status: 200 },
        ),
      ),
    );
    render(<AddFood logDate="2026-10-07" mealTypes={meals} aiReady />);
    fireEvent.change(screen.getByLabelText("Search foods"), { target: { value: "ma2loubeh" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("button", { name: /Mom's Maqlouba/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/How do you want to add it/)).not.toBeInTheDocument();
  });
});

describe("AddFood — your own recipe first (§13G)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists the family recipe above everything else, with what a serving costs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            foods: [{ ...chicken, name: "Rice, white, cooked" }],
            recipes: [
              { id: 7, name: "Mom's Chicken Maqlouba", servings: 6, kcalPerServing: 540, proteinPerServing: 28 },
            ],
            recognised: null,
            strongMatch: true,
          }),
          { status: 200 },
        ),
      ),
    );
    render(<AddFood logDate="2026-10-08" mealTypes={meals} aiReady />);
    fireEvent.change(screen.getByLabelText("Search foods"), { target: { value: "ma2loubeh" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const heading = await screen.findByText("Your recipes", {}, { timeout: 5000 });
    expect(screen.getByText("Mom's Chicken Maqlouba")).toBeInTheDocument();
    expect(screen.getByText(/540 kcal · 28 g protein a serving · makes 6/)).toBeInTheDocument();
    // Above the database results, which are still there to choose.
    const rice = screen.getByRole("button", { name: /Rice, white, cooked/ });
    expect(heading.compareDocumentPosition(rice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/How do you want to add it/)).not.toBeInTheDocument();
  });
});
