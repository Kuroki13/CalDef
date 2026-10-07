import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const action = vi.fn();
vi.mock("@/app/(app)/diary/repeat-actions", () => ({
  repeatEntriesAction: (prev: unknown, form: FormData) => action(prev, form),
}));

const { CopyMealForm, LogAgainForm } = await import("@/components/repeat-forms");
import type { DiaryEntry } from "@/lib/diary";

const entry = (id: number, name: string, over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id,
  meal_type_id: 1,
  amount: 150,
  unit: "g",
  grams: 150,
  source: "manual",
  notes: null,
  foodName: name,
  foodBrand: null,
  servingLabel: null,
  foodId: id,
  isFavorite: false,
  isEstimate: false,
  confidence: "strong",
  kcal: 200,
  protein_g: 10,
  carbs_g: 20,
  fat_g: 5,
  ...over,
});

const meals = [{ id: 1, slug: "breakfast", name: "Breakfast", sort_order: 1 }];

beforeEach(() => {
  vi.clearAllMocks();
  action.mockResolvedValue({ ok: true, notice: "Added 2 items." });
});

describe("CopyMealForm", () => {
  const yesterday = [
    entry(11, "Oats"),
    entry(12, "Protein yogurt", { unit: "serving", amount: 1, servingLabel: "1 pot" }),
  ];

  it("starts with everything ticked and each amount editable, in its own unit", () => {
    render(<CopyMealForm entries={yesterday} mealTypeId={1} mealName="Breakfast" logDate="2026-10-07" />);
    expect(screen.getByLabelText("Oats")).toBeChecked();
    expect(screen.getByLabelText("Amount of Protein yogurt (1 pot)")).toHaveValue(1);
    expect(screen.getByRole("button", { name: "Add 2 to Breakfast" })).toBeEnabled();
  });

  it("sends only what stays ticked, with the edited amount", async () => {
    render(<CopyMealForm entries={yesterday} mealTypeId={1} mealName="Breakfast" logDate="2026-10-07" />);
    fireEvent.click(screen.getByLabelText("Oats"));
    fireEvent.change(screen.getByLabelText("Amount of Protein yogurt (1 pot)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 1 to Breakfast" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce(), { timeout: 5000 });
    const form: FormData = action.mock.calls[0][1];
    expect(form.getAll("include")).toEqual(["12"]);
    expect(form.getAll("amount")).toEqual(["150", "2"]);
    expect(form.get("logDate")).toBe("2026-10-07");
  });

  it("cannot be sent with nothing ticked", () => {
    render(<CopyMealForm entries={[entry(11, "Oats")]} mealTypeId={1} mealName="Breakfast" logDate="2026-10-07" />);
    fireEvent.click(screen.getByLabelText("Oats"));
    expect(screen.getByRole("button", { name: "Add 0 to Breakfast" })).toBeDisabled();
  });

  it("leaves no button to press twice once it has worked", async () => {
    render(<CopyMealForm entries={yesterday} mealTypeId={1} mealName="Breakfast" logDate="2026-10-07" />);
    fireEvent.click(screen.getByRole("button", { name: "Add 2 to Breakfast" }));
    await screen.findByText("Added 2 items.", {}, { timeout: 5000 });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("LogAgainForm", () => {
  it("prefills the amount and the meal, defaults to today, and sends one entry", async () => {
    action.mockResolvedValue({ ok: true, notice: "Added 1 item." });
    render(<LogAgainForm entry={entry(11, "Oats")} mealTypes={meals} defaultDate="2026-10-07" />);
    expect(screen.getByLabelText(/Amount/)).toHaveValue(150);
    expect(screen.getByLabelText("Day")).toHaveValue("2026-10-07");

    fireEvent.click(screen.getByRole("button", { name: "Log Oats again" }));
    await screen.findByText("Added 1 item.", {}, { timeout: 5000 });
    const form: FormData = action.mock.calls[0][1];
    expect(form.get("includeAll")).toBe("true");
    expect(form.get("entryId")).toBe("11");
    expect(form.get("mealTypeId")).toBe("1");
  });
});
