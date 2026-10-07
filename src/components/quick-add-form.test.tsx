import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const action = vi.fn();
vi.mock("@/app/(app)/diary/quick-add-actions", () => ({
  quickAddAction: (prev: unknown, form: FormData) => action(prev, form),
}));

const { QuickAddForm } = await import("@/components/quick-add-form");

const meals = [{ id: 3, slug: "dinner", name: "Dinner", sort_order: 3 }];

beforeEach(() => {
  vi.clearAllMocks();
  action.mockResolvedValue({ ok: true, notice: 'Added "Dinner out" — 750 kcal, as your estimate.' });
});

describe("QuickAddForm (§12G)", () => {
  it("says it is an estimate and not a food before anything is typed", () => {
    render(<QuickAddForm logDate="2026-10-07" mealTypes={meals} />);
    expect(screen.getByText(/not as verified nutrition/)).toBeInTheDocument();
    expect(screen.getByText(/does not become a\s+food/)).toBeInTheDocument();
  });

  it("sends the label and figures, then gives way to the result", async () => {
    render(<QuickAddForm logDate="2026-10-07" mealTypes={meals} />);
    fireEvent.change(screen.getByLabelText("What was it"), { target: { value: "Dinner out" } });
    fireEvent.change(screen.getByLabelText("Calories (kcal)"), { target: { value: "750" } });
    fireEvent.change(screen.getByLabelText("Protein (g, optional)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Add estimate" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce(), { timeout: 5000 });
    const form: FormData = action.mock.calls[0][1];
    expect(form.get("label")).toBe("Dinner out");
    expect(form.get("kcal")).toBe("750");
    expect(form.get("protein_g")).toBe("45");
    expect(form.get("logDate")).toBe("2026-10-07");

    await screen.findByText(/as your estimate/, {}, { timeout: 5000 });
    expect(screen.queryByRole("button", { name: "Add estimate" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add another" }));
    expect(screen.getByRole("button", { name: "Add estimate" })).toBeInTheDocument();
  });
});
