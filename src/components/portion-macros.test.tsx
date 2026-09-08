import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PortionMacros, ServingHint, portionMacros } from "@/components/portion-macros";
import type { Food } from "@/lib/food/types";

const food = (over: Partial<Food> = {}): Food => ({
  sourceId: "1",
  source: "usda",
  name: "Chicken breast",
  brand: null,
  description: null,
  barcode: null,
  isVerified: true,
  nutrients: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  servings: [{ label: "100 g", grams: 100, isDefault: true }],
  dataUpdatedAt: null,
  ...over,
});

describe("portionMacros — the same arithmetic the server will do", () => {
  it("scales to the amount entered", () => {
    const result = portionMacros(food(), 200, "g");
    expect(result?.grams).toBe(200);
    expect(result?.macros.kcal).toBeCloseTo(330);
    expect(result?.macros.protein_g).toBeCloseTo(62);
  });

  it("weighs a serving by its own gram weight", () => {
    const bar = food({
      nutrients: { kcal: 400, protein_g: 20, carbs_g: 45, fat_g: 12 },
      servings: [{ label: "1 bar", grams: 45, isDefault: true }],
    });

    const result = portionMacros(bar, 2, "serving", bar.servings[0]);

    expect(result?.grams).toBe(90);
    expect(result?.macros.kcal).toBeCloseTo(360);
  });

  it("refuses a serving with no weight behind it rather than inventing one", () => {
    expect(portionMacros(food(), 1, "serving", null)).toBeNull();
  });

  it("refuses an amount that is not one", () => {
    expect(portionMacros(food(), 0, "g")).toBeNull();
    expect(portionMacros(food(), -5, "g")).toBeNull();
    expect(portionMacros(food(), Number.NaN, "g")).toBeNull();
    expect(portionMacros(food(), 200000, "g")).toBeNull();
  });
});

describe("PortionMacros — shown before logging, not after", () => {
  it("states the cost of the amount entered", () => {
    render(<PortionMacros food={food()} amount={200} unit="g" />);

    const line = screen.getByText(/330 kcal/).closest("p");
    expect(line).toHaveTextContent("Protein 62.0 g");
    expect(line).toHaveTextContent("Carbs 0.0 g");
    expect(line).toHaveTextContent("Fat 7.2 g");
  });

  it("gives the gram weight when the unit is not grams", () => {
    const bar = food({
      servings: [{ label: "1 bar", grams: 45, isDefault: true }],
    });

    render(
      <PortionMacros
        food={bar}
        amount={2}
        unit="serving"
        serving={bar.servings[0]}
      />,
    );

    expect(screen.getByText(/90 g/)).toBeInTheDocument();
  });

  it("announces itself politely, since it changes as the amount is typed", () => {
    render(<PortionMacros food={food()} amount={100} unit="g" />);
    expect(screen.getByText(/165 kcal/).closest("p")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("says what to do instead of showing a figure it cannot compute", () => {
    render(<PortionMacros food={food()} amount={1} unit="serving" serving={null} />);

    expect(screen.getByText(/no serving weight/i)).toBeInTheDocument();
  });
});

describe("ServingHint — what a results row is worth eating", () => {
  it("adds the food's own serving beside the per-100 g figure", () => {
    const bar = food({
      nutrients: { kcal: 422, protein_g: 20, carbs_g: 45, fat_g: 12 },
      servings: [{ label: "1 bar", grams: 45, isDefault: true }],
    });

    render(<ServingHint food={bar} />);

    // "422 kcal / 100 g" says less about a flapjack than "1 bar: 190 kcal".
    expect(screen.getByText(/1 bar: 190 kcal/)).toBeInTheDocument();
  });

  it("shows nothing for a food with no serving", () => {
    const { container } = render(<ServingHint food={food({ servings: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
