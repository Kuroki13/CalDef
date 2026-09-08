import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoodProposalReview } from "./food-proposal-review";
import { restaurantById } from "@/lib/food/restaurant-catalogue";
import type { FoodProposal } from "@/lib/ai/resolve";

const log = vi.fn();
const save = vi.fn();
vi.mock("@/app/(app)/diary/ai-actions", () => ({ logParsedFoods: (...args: unknown[]) => log(...args), saveParsedFoods: (...args: unknown[]) => save(...args) }));
const food = restaurantById("restaurant:harveys:big-harv-angus")!;
const proposal: FoodProposal = { intent: { query: "Harvey's Big Angus burger", amount: 1, unit: "serving" }, match: food, alternatives: [], grams: 281, macros: null };
const props = { proposals: [proposal], logDate: "2026-09-06", mealTypes: [{ id: 2, name: "Lunch", slug: "lunch", sort_order: 2 }] };
beforeEach(() => {
  vi.clearAllMocks();
  log.mockResolvedValue({ ok: true, notice: "Added 1 item." });
  save.mockResolvedValue({ ok: true, notice: "Saved. Nothing was added to your diary." });
});
describe("shared food review", () => {
  it("shows source, portion and macros before any write", () => {
    render(<FoodProposalReview {...props} />);
    // Asserted on the line rather than the element, because the figures are
    // now rendered by the shared `PortionMacros` and its internal markup is
    // not what this test is about.
    const line = screen.getByText(/750 kcal/).closest("p");
    expect(line).toHaveTextContent("750 kcal");
    expect(line).toHaveTextContent("Protein 36.0 g");
    expect(screen.getByRole("link", { name: "Nutrition source" })).toHaveAttribute("href", "https://www.harveys.ca/en/nutrition.html");
    expect(screen.getByText(/Saved reference, not a live web search/)).toBeInTheDocument();
    expect(log).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("sends the corrected portion and date only after confirmation, and locks success", async () => {
    render(<FoodProposalReview {...props} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-05" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm:/ }));
    await waitFor(() => expect(log).toHaveBeenCalledOnce());
    const payload = JSON.parse(log.mock.calls[0][1].get("payload"));
    expect(payload.logDate).toBe("2026-09-05");
    expect(payload.items[0].amount).toBe(2);
    expect(payload.items[0].servingLabel).toBe(food.servings[0].label);
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm:/ })).toBeDisabled());
  });
  it("will not log a serving of unknown weight until grams are supplied", () => {
    render(<FoodProposalReview {...props} proposals={[{ ...proposal, match: { ...food, servings: [] } }]} />);
    expect(screen.getByRole("button", { name: /Confirm:/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "g" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "281" } });
    expect(screen.getByRole("button", { name: /Confirm:/ })).toBeEnabled();
  });
  it("save mode uses its separate action and has no meal/date inputs", async () => {
    render(<FoodProposalReview {...props} mode="save" />);
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /without logging/ }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(log).not.toHaveBeenCalled();
  });
});
