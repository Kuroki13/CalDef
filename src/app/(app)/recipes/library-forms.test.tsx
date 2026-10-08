import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logSavedMealAction = vi.fn();
const logRecipeAction = vi.fn();
vi.mock("@/app/(app)/recipes/actions", () => ({
  addIngredientsAction: vi.fn(),
  createRecipeAction: vi.fn(),
  createSavedMealAction: vi.fn(),
  logFavoriteAction: vi.fn(),
  logRecipeAction: (prev: unknown, form: FormData) => logRecipeAction(prev, form),
  updateRecipeSettingsAction: vi.fn(),
  logSavedMealAction: (prev: unknown, form: FormData) => logSavedMealAction(prev, form),
}));

const { LogRecipeForm, LogSavedMealForm } = await import("@/app/(app)/recipes/library-forms");

const meals = [{ id: 1, slug: "lunch", name: "Lunch", sort_order: 2 }];
const items = [
  { id: 31, foodName: "Basmati rice", amount: 200, unit: "g" as const, servingLabel: null },
  { id: 32, foodName: "Protein yogurt", amount: 1, unit: "serving" as const, servingLabel: "1 pot" },
];

const renderForm = () =>
  render(
    <LogSavedMealForm
      savedMealId={5}
      logDate="2026-10-07"
      mealTypes={meals}
      defaultMealTypeId={1}
      items={items}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  logSavedMealAction.mockResolvedValue({ ok: true, notice: "Added 1 item to your diary." });
});

describe("LogSavedMealForm — a template, not a prescription (§12F)", () => {
  it("lists every item ticked, with its amount in its own unit", () => {
    renderForm();
    expect(screen.getByLabelText("Basmati rice")).toBeChecked();
    expect(screen.getByLabelText("Amount of Protein yogurt (1 pot)")).toHaveValue(1);
    expect(screen.getByRole("button", { name: "Log 2" })).toBeEnabled();
  });

  it("sends this time's changes: an item left out, an amount changed", async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText("Protein yogurt"));
    fireEvent.change(screen.getByLabelText("Amount of Basmati rice (g)"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Log 1" }));

    await waitFor(() => expect(logSavedMealAction).toHaveBeenCalledOnce(), { timeout: 5000 });
    const form: FormData = logSavedMealAction.mock.calls[0][1];
    expect(form.getAll("itemId")).toEqual(["31", "32"]);
    expect(form.getAll("amount")).toEqual(["150", "1"]);
    expect(form.getAll("include")).toEqual(["31"]);
  });

  it("cannot log with nothing ticked", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText("Basmati rice"));
    fireEvent.click(screen.getByLabelText("Protein yogurt"));
    expect(screen.getByRole("button", { name: "Log 0" })).toBeDisabled();
  });

  it("gives way to the result, and logging again is deliberate", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Log 2" }));
    await screen.findByText("Added 1 item to your diary.", {}, { timeout: 5000 });
    expect(screen.queryByRole("button", { name: /^Log \d/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log it again" }));
    expect(screen.getByRole("button", { name: "Log 2" })).toBeEnabled();
  });
});

describe("LogRecipeForm — grams only for a weighed dish (§13G)", () => {
  it("offers servings alone when the finished dish was never weighed", () => {
    render(<LogRecipeForm recipeId={7} logDate="2026-10-08" mealTypes={meals} />);
    expect(screen.getByLabelText("Servings")).toHaveValue(1);
    expect(screen.queryByLabelText("In")).not.toBeInTheDocument();
  });

  it("offers grams once it was, and says what a serving weighs", async () => {
    logRecipeAction.mockResolvedValue({ ok: true, notice: "Added to your diary." });
    render(
      <LogRecipeForm recipeId={7} logDate="2026-10-08" mealTypes={meals} cookedWeightG={2400} servings={6} />,
    );
    expect(screen.getByText("One serving is about 400 g of the finished dish.")).toBeInTheDocument();
    expect(screen.getByLabelText("In")).toBeInTheDocument();
  });
});
