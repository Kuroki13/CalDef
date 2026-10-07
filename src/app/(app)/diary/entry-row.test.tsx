import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/diary/actions", () => ({ deleteEntry: vi.fn(), updateEntryAmount: vi.fn() }));
vi.mock("@/app/(app)/diary/ai-actions", () => ({ applyCorrection: vi.fn() }));
vi.mock("@/app/(app)/recipes/actions", () => ({ toggleFavoriteAction: vi.fn() }));
vi.mock("@/app/(app)/diary/repeat-actions", () => ({ repeatEntriesAction: vi.fn() }));

const { EntryRow } = await import("@/app/(app)/diary/entry-row");
import type { DiaryEntry } from "@/lib/diary";

const estimate: DiaryEntry = {
  id: 1, meal_type_id: 3, amount: 1, unit: "serving", grams: 0, source: "manual",
  notes: "Dinner out", foodName: "Dinner out", foodBrand: null, servingLabel: null,
  foodId: null, isFavorite: false, isEstimate: true,
  kcal: 750, protein_g: 45, carbs_g: 0, fat_g: 0,
};

describe("EntryRow — a Quick Add", () => {
  it("reads as the user's estimate, with no weight and no Edit", () => {
    render(<EntryRow entry={estimate} aiEnabled mealTypes={[]} />);
    expect(screen.getByText("Your estimate")).toBeInTheDocument();
    expect(screen.queryByText(/0 g ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Dinner out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Star/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Dinner out" })).toBeInTheDocument();
  });
});
